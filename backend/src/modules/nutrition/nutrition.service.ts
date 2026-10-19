import { PoolClient } from 'pg';
import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { AccessTokenPayload } from '../auth/auth.service';
import { CreateLogInput, CreatePlanInput, PlanContent } from './nutrition.schemas';

type Auth = AccessTokenPayload;
type Db = Pick<PoolClient, 'query'>;

const notFound = (what: string) => new AppError(404, 'not_found', `${what} não encontrado`);
const num = (v: string | null) => (v === null ? null : Number(v));
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------- acesso ----------

async function isLinkedNutritionist(nutritionistId: string, patientId: string, db: Db = pool) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM nutritionist_patient WHERE nutritionist_id = $1 AND patient_id = $2 AND status = 'active'`,
    [nutritionistId, patientId],
  );
  return (rowCount ?? 0) > 0;
}

/** O paciente vê os próprios dados; o nutricionista, os de pacientes com vínculo ativo; o admin, tudo. */
async function canAccessPatient(auth: Auth, patientId: string) {
  if (auth.role === 'admin' || auth.sub === patientId) return true;
  return auth.role === 'nutritionist' && isLinkedNutritionist(auth.sub, patientId);
}

// ---------- alimentos ----------

const FOOD_COLS = `id, name, source, category, kcal_per_100g AS "kcalPer100g", protein_per_100g AS "proteinPer100g",
  carb_per_100g AS "carbPer100g", fat_per_100g AS "fatPer100g", barcode`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

function foodOut(r: any) {
  return {
    ...r,
    kcalPer100g: Number(r.kcalPer100g),
    proteinPer100g: Number(r.proteinPer100g),
    carbPer100g: Number(r.carbPer100g),
    fatPer100g: Number(r.fatPer100g),
  };
}

export async function listFoods(filter: { q?: string; category?: string }) {
  const q = filter.q ? escapeLike(filter.q) : null;
  const { rows } = await pool.query(
    `SELECT ${FOOD_COLS} FROM foods
     WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR lower(category) = lower($2))
     ORDER BY ($1::text IS NOT NULL AND lower(name) LIKE lower($1) || '%') DESC, length(name), name
     LIMIT 50`,
    [q, filter.category ?? null],
  );
  return rows.map(foodOut);
}

export async function getFood(id: string) {
  const { rows } = await pool.query(`SELECT ${FOOD_COLS} FROM foods WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Alimento');
  return foodOut(rows[0]);
}

export async function createFood(input: {
  name: string;
  kcalPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
  barcode?: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO foods (name, source, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, barcode)
     VALUES ($1, 'custom', $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING ${FOOD_COLS}`,
    [input.name, input.kcalPer100g, input.proteinPer100g, input.carbPer100g, input.fatPer100g, input.barcode ?? null],
  );
  if (!rows[0]) throw new AppError(409, 'food_exists', 'Já existe um alimento personalizado com esse nome');
  return foodOut(rows[0]);
}

// ---------- planos alimentares ----------

interface PlanRow {
  id: string;
  patient_id: string;
  prescribed_by: string | null;
  title: string;
  source: 'ai' | 'nutritionist' | 'self';
  target_kcal: string | null;
  target_protein_g: string | null;
  target_carb_g: string | null;
  target_fat_g: string | null;
  status: 'draft' | 'active' | 'archived';
  created_at: Date;
}

async function insertMeals(db: Db, planId: string, meals: PlanContent['meals']) {
  const foodIds = [...new Set(meals.flatMap((m) => m.foods.map((f) => f.foodId)))];
  const { rows } = await db.query('SELECT id FROM foods WHERE id = ANY($1::uuid[])', [foodIds]);
  if (rows.length !== foodIds.length) throw new AppError(400, 'unknown_food', 'Um ou mais alimentos não existem');

  for (const [index, meal] of meals.entries()) {
    const { rows: mealRows } = await db.query<{ id: string }>(
      `INSERT INTO meals (plan_id, name, "order", time_suggestion) VALUES ($1, $2, $3, $4) RETURNING id`,
      [planId, meal.name, index + 1, meal.timeSuggestion ?? null],
    );
    for (const f of meal.foods) {
      await db.query('INSERT INTO meal_foods (meal_id, food_id, quantity_g) VALUES ($1, $2, $3)', [
        mealRows[0].id,
        f.foodId,
        f.quantityG,
      ]);
    }
  }
}

async function loadPlanRow(id: string, db: Db = pool): Promise<PlanRow | null> {
  const { rows } = await db.query<PlanRow>('SELECT * FROM diet_plans WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/** Rascunho só é visível ao profissional que o prescreveu (e ao admin). */
async function assertCanView(auth: Auth, plan: PlanRow) {
  if (auth.role === 'admin') return;
  if (plan.patient_id === auth.sub) {
    if (plan.status === 'draft' && plan.source !== 'self') throw notFound('Plano');
    return;
  }
  if (
    plan.prescribed_by === auth.sub &&
    auth.role === 'nutritionist' &&
    (await isLinkedNutritionist(auth.sub, plan.patient_id))
  ) {
    return;
  }
  throw notFound('Plano');
}

function assertPrescriber(auth: Auth, plan: PlanRow) {
  if (plan.prescribed_by !== auth.sub || auth.role !== 'nutritionist') throw notFound('Plano');
}

async function buildPlan(plan: PlanRow) {
  const { rows } = await pool.query(
    `SELECT m.id AS meal_id, m.name AS meal_name, m."order", to_char(m.time_suggestion, 'HH24:MI') AS time_suggestion,
            mf.id AS mf_id, mf.quantity_g,
            f.id AS food_id, f.name AS food_name, f.kcal_per_100g, f.protein_per_100g, f.carb_per_100g, f.fat_per_100g
     FROM meals m
     LEFT JOIN meal_foods mf ON mf.meal_id = m.id
     LEFT JOIN foods f ON f.id = mf.food_id
     WHERE m.plan_id = $1
     ORDER BY m."order", f.name`,
    [plan.id],
  );

  const meals = new Map<string, any>();
  const totals = { kcal: 0, proteinG: 0, carbG: 0, fatG: 0 };
  for (const r of rows) {
    if (!meals.has(r.meal_id)) {
      meals.set(r.meal_id, {
        id: r.meal_id,
        name: r.meal_name,
        order: r.order,
        timeSuggestion: r.time_suggestion,
        foods: [],
      });
    }
    if (r.mf_id) {
      const k = Number(r.quantity_g) / 100;
      const macros = {
        kcal: round1(Number(r.kcal_per_100g) * k),
        proteinG: round1(Number(r.protein_per_100g) * k),
        carbG: round1(Number(r.carb_per_100g) * k),
        fatG: round1(Number(r.fat_per_100g) * k),
      };
      totals.kcal += macros.kcal;
      totals.proteinG += macros.proteinG;
      totals.carbG += macros.carbG;
      totals.fatG += macros.fatG;
      meals.get(r.meal_id).foods.push({
        id: r.mf_id,
        food: { id: r.food_id, name: r.food_name },
        quantityG: Number(r.quantity_g),
        ...macros,
      });
    }
  }

  return {
    id: plan.id,
    patientId: plan.patient_id,
    prescribedBy: plan.prescribed_by,
    title: plan.title,
    source: plan.source,
    status: plan.status,
    targets: {
      kcal: num(plan.target_kcal),
      proteinG: num(plan.target_protein_g),
      carbG: num(plan.target_carb_g),
      fatG: num(plan.target_fat_g),
    },
    totals: {
      kcal: round1(totals.kcal),
      proteinG: round1(totals.proteinG),
      carbG: round1(totals.carbG),
      fatG: round1(totals.fatG),
    },
    createdAt: plan.created_at,
    meals: [...meals.values()],
  };
}

export async function createPlan(auth: Auth, input: CreatePlanInput) {
  let patientId: string;
  let prescribedBy: string | null;
  let source: 'nutritionist' | 'self';
  let status: 'draft' | 'active';

  if (auth.role === 'nutritionist') {
    if (!input.patientId) throw new AppError(400, 'patient_required', 'Informe patientId');
    if (!(await isLinkedNutritionist(auth.sub, input.patientId))) {
      throw new AppError(403, 'not_linked', 'Você não tem vínculo ativo com este paciente');
    }
    // Prescrição: nasce como rascunho e só chega ao paciente após aprovação do nutricionista.
    patientId = input.patientId;
    prescribedBy = auth.sub;
    source = 'nutritionist';
    status = 'draft';
  } else if (auth.role === 'student') {
    patientId = auth.sub;
    prescribedBy = null;
    source = 'self';
    status = 'active';
  } else {
    throw new AppError(403, 'forbidden', 'Sem permissão');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<PlanRow>(
      `INSERT INTO diet_plans (patient_id, prescribed_by, title, source, status,
                               target_kcal, target_protein_g, target_carb_g, target_fat_g)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        patientId,
        prescribedBy,
        input.title,
        source,
        status,
        input.targetKcal ?? null,
        input.targetProteinG ?? null,
        input.targetCarbG ?? null,
        input.targetFatG ?? null,
      ],
    );
    await insertMeals(client, rows[0].id, input.meals);
    await client.query('COMMIT');
    return await buildPlan(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function getPlan(auth: Auth, id: string) {
  const plan = await loadPlanRow(id);
  if (!plan) throw notFound('Plano');
  await assertCanView(auth, plan);
  return buildPlan(plan);
}

export async function listPlans(auth: Auth, filter: { patientId?: string; status?: string }) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (auth.role === 'nutritionist') {
    add('p.prescribed_by = ?', auth.sub);
    where.push(
      `EXISTS (SELECT 1 FROM nutritionist_patient np
               WHERE np.nutritionist_id = p.prescribed_by AND np.patient_id = p.patient_id AND np.status = 'active')`,
    );
    if (filter.patientId) add('p.patient_id = ?', filter.patientId);
  } else if (auth.role === 'admin') {
    if (filter.patientId) add('p.patient_id = ?', filter.patientId);
  } else {
    add('p.patient_id = ?', auth.sub);
    where.push(`NOT (p.status = 'draft' AND p.source <> 'self')`);
  }
  if (filter.status) add('p.status = ?', filter.status);

  const { rows } = await pool.query(
    `SELECT p.id, p.patient_id AS "patientId", p.prescribed_by AS "prescribedBy", p.title, p.source, p.status,
            p.created_at AS "createdAt"
     FROM diet_plans p
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.created_at DESC
     LIMIT 100`,
    params,
  );
  return rows;
}

export async function updatePlan(auth: Auth, id: string, content: PlanContent) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<PlanRow>('SELECT * FROM diet_plans WHERE id = $1 FOR UPDATE', [id]);
    const plan = rows[0];
    if (!plan) throw notFound('Plano');
    assertPrescriber(auth, plan);
    if (plan.status !== 'draft') throw new AppError(409, 'plan_not_draft', 'Só rascunhos podem ser editados');

    await client.query(
      `UPDATE diet_plans
       SET title = $2, target_kcal = $3, target_protein_g = $4, target_carb_g = $5, target_fat_g = $6
       WHERE id = $1`,
      [
        id,
        content.title,
        content.targetKcal ?? null,
        content.targetProteinG ?? null,
        content.targetCarbG ?? null,
        content.targetFatG ?? null,
      ],
    );
    await client.query('DELETE FROM meals WHERE plan_id = $1', [id]);
    await insertMeals(client, id, content.meals);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return getPlan(auth, id);
}

export async function approvePlan(auth: Auth, id: string) {
  const plan = await loadPlanRow(id);
  if (!plan) throw notFound('Plano');
  assertPrescriber(auth, plan);
  if (!(await isLinkedNutritionist(auth.sub, plan.patient_id))) {
    throw new AppError(403, 'not_linked', 'Você não tem vínculo ativo com este paciente');
  }
  const { rowCount } = await pool.query(
    `UPDATE diet_plans SET status = 'active' WHERE id = $1 AND status = 'draft'`,
    [id],
  );
  if (!rowCount) throw new AppError(409, 'plan_not_draft', 'Só rascunhos podem ser aprovados');
  return getPlan(auth, id);
}

export async function archivePlan(auth: Auth, id: string) {
  const plan = await loadPlanRow(id);
  if (!plan) throw notFound('Plano');
  const isSelfOwner = plan.source === 'self' && plan.patient_id === auth.sub;
  if (!isSelfOwner) assertPrescriber(auth, plan);
  await pool.query(`UPDATE diet_plans SET status = 'archived' WHERE id = $1`, [id]);
  return getPlan(auth, id);
}

// ---------- log de comida ----------

async function loadEntries(where: string, params: unknown[]) {
  const { rows } = await pool.query(
    `SELECT l.id, l.food_id, l.meal_id, l.quantity_g, l.recognition_source, l.logged_at,
            f.name, f.kcal_per_100g, f.protein_per_100g, f.carb_per_100g, f.fat_per_100g
     FROM food_logs l JOIN foods f ON f.id = l.food_id
     WHERE ${where}
     ORDER BY l.logged_at, l.id`,
    params,
  );
  return rows.map((r) => {
    const k = Number(r.quantity_g) / 100;
    return {
      id: r.id,
      food: { id: r.food_id, name: r.name },
      mealId: r.meal_id,
      quantityG: Number(r.quantity_g),
      recognitionSource: r.recognition_source,
      loggedAt: r.logged_at,
      kcal: round1(Number(r.kcal_per_100g) * k),
      proteinG: round1(Number(r.protein_per_100g) * k),
      carbG: round1(Number(r.carb_per_100g) * k),
      fatG: round1(Number(r.fat_per_100g) * k),
    };
  });
}

export async function createLogs(auth: Auth, input: CreateLogInput) {
  const foodIds = [...new Set(input.items.map((i) => i.foodId))];
  const { rows: foods } = await pool.query('SELECT id FROM foods WHERE id = ANY($1::uuid[])', [foodIds]);
  if (foods.length !== foodIds.length) throw new AppError(400, 'unknown_food', 'Um ou mais alimentos não existem');

  // mealId só vale se for refeição de um plano ativo do próprio usuário.
  const mealIds = [...new Set(input.items.flatMap((i) => (i.mealId ? [i.mealId] : [])))];
  if (mealIds.length) {
    const { rows } = await pool.query(
      `SELECT m.id FROM meals m JOIN diet_plans p ON p.id = m.plan_id
       WHERE m.id = ANY($1::uuid[]) AND p.patient_id = $2 AND p.status = 'active'`,
      [mealIds, auth.sub],
    );
    if (rows.length !== mealIds.length) {
      throw new AppError(400, 'invalid_meal', 'Refeição inválida para o seu plano ativo');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids: string[] = [];
    for (const item of input.items) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO food_logs (user_id, food_id, meal_id, quantity_g, recognition_source, logged_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now())) RETURNING id`,
        [auth.sub, item.foodId, item.mealId ?? null, item.quantityG, input.recognitionSource, input.loggedAt ?? null],
      );
      ids.push(rows[0].id);
    }
    await client.query('COMMIT');
    return { entries: await loadEntries('l.id = ANY($1::uuid[])', [ids]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Log do dia (fuso de config.timezone) com totais e metas do plano ativo. */
export async function getDayLog(auth: Auth, filter: { date?: string; userId?: string }) {
  const userId = filter.userId ?? auth.sub;
  if (!(await canAccessPatient(auth, userId))) throw notFound('Paciente');

  const { rows: dateRows } = await pool.query<{ d: string }>(
    `SELECT COALESCE($1::date, (now() AT TIME ZONE $2)::date)::text AS d`,
    [filter.date ?? null, config.timezone],
  );
  const date = dateRows[0].d;

  const entries = await loadEntries(
    `l.user_id = $1
     AND l.logged_at >= ($2::date)::timestamp AT TIME ZONE $3
     AND l.logged_at <  (($2::date) + 1)::timestamp AT TIME ZONE $3`,
    [userId, date, config.timezone],
  );
  const totals = entries.reduce(
    (t, e) => ({
      kcal: t.kcal + e.kcal,
      proteinG: t.proteinG + e.proteinG,
      carbG: t.carbG + e.carbG,
      fatG: t.fatG + e.fatG,
    }),
    { kcal: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );

  const { rows: plans } = await pool.query<PlanRow>(
    `SELECT * FROM diet_plans WHERE patient_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const plan = plans[0];

  return {
    date,
    entries,
    totals: {
      kcal: round1(totals.kcal),
      proteinG: round1(totals.proteinG),
      carbG: round1(totals.carbG),
      fatG: round1(totals.fatG),
    },
    targets: plan
      ? {
          kcal: num(plan.target_kcal),
          proteinG: num(plan.target_protein_g),
          carbG: num(plan.target_carb_g),
          fatG: num(plan.target_fat_g),
        }
      : null,
  };
}

export async function deleteLog(auth: Auth, id: string) {
  const { rowCount } = await pool.query('DELETE FROM food_logs WHERE id = $1 AND user_id = $2', [id, auth.sub]);
  if (!rowCount) throw notFound('Registro');
}
