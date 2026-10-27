import { PoolClient } from 'pg';
import { loadPreferences, sortByPreference } from '../preferences/preferences.service';
import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { displayFoodName, foodStateRank } from '../../shared/food-name';
import { AccessTokenPayload } from '../auth/auth.service';
import { computeEnergyTarget } from './energy.service';
import { CreateLogInput, CreatePlanInput, mealInputTypes, mealTypes, PlanContent, UpdateLogInput } from './nutrition.schemas';
import { fetchOffProduct, upsertOffFood } from './openfoodfacts';

type Auth = AccessTokenPayload;
type Db = Pick<PoolClient, 'query'>;
type MealType = (typeof mealTypes)[number];
type MealInput = (typeof mealInputTypes)[number];

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

export const foodCols = (a = '') => `${a}id, ${a}name, ${a}source, ${a}category, ${a}kcal_per_100g AS "kcalPer100g",
  ${a}protein_per_100g AS "proteinPer100g", ${a}carb_per_100g AS "carbPer100g", ${a}fat_per_100g AS "fatPer100g",
  ${a}barcode, ${a}portions`;
const FOOD_COLS = foodCols();

interface Portion {
  label: string;
  grams: number;
}

export function foodOut(r: any) {
  return {
    ...r,
    displayName: displayFoodName(r.name, r.source, r.category),
    kcalPer100g: Number(r.kcalPer100g),
    proteinPer100g: Number(r.proteinPer100g),
    carbPer100g: Number(r.carbPer100g),
    fatPer100g: Number(r.fatPer100g),
  };
}

/**
 * Preparado (cozido, grelhado, assado, frito) antes de alimento sem estado (frutas, saladas) e de cru que ninguém
 * registra assim (carne, arroz). Dentro de cada grupo, nomes que começam pelo termo e os mais curtos vêm primeiro
 * ("Frango grelhado" antes de "Coração de frango grelhado"); o resto segue a relevância da consulta (sort estável).
 */
function rankByState<T extends { name: string; source: string; category: string | null }>(rows: T[], q: string): T[] {
  const first = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).find(Boolean) ?? '';
  const key = (r: T) => {
    const shown = displayFoodName(r.name, r.source, r.category);
    const starts = shown.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(first) ? 0 : 1;
    return [foodStateRank(r.name, r.source, r.category), starts, shown.length];
  };
  return [...rows].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
}

/**
 * Busca fuzzy: ignora acento e caixa, aceita as palavras em qualquer ordem e tolera erro de digitação
 * (trigram). Cada palavra precisa aparecer no nome ou ser parecida o bastante com algum trecho dele.
 */
export async function listFoods(filter: { q?: string; category?: string }, userId?: string) {
  const category = filter.category ?? null;
  // Preferências do questionário: "gosto" sobe, "não gosto" desce (nunca some). Sem preferências, nada muda.
  const prefs = userId ? await loadPreferences(userId) : null;
  if (!filter.q) {
    const { rows } = await pool.query(
      `SELECT ${FOOD_COLS} FROM foods WHERE ($1::text IS NULL OR lower(category) = lower($1)) ORDER BY name LIMIT 50`,
      [category],
    );
    return sortByPreference(rows, prefs, (r) => r.name as string).map(foodOut);
  }

  const { rows } = await pool.query(
    `WITH q AS (
       SELECT f_unaccent(lower($1)) AS s,
              array_remove(regexp_split_to_array(f_unaccent(lower($1)), '[^a-z0-9]+'), '') AS toks
     )
     SELECT ${foodCols('f.')}
     FROM foods f, q
     WHERE cardinality(q.toks) > 0
       AND ($2::text IS NULL OR lower(f.category) = lower($2))
       AND (SELECT bool_and(f.name_search LIKE '%' || t || '%'
                            OR (length(t) >= 5 AND word_similarity(t, f.name_search) >= 0.6))
            FROM unnest(q.toks) t)
     ORDER BY (SELECT bool_and(f.name_search LIKE '%' || t || '%') FROM unnest(q.toks) t) DESC,
              (f.source = 'taco') DESC, -- alimento genérico da TACO antes de produtos de marca
              (f.name_search LIKE q.toks[1] || '%') DESC,
              word_similarity(q.s, f.name_search) DESC,
              length(f.name), f.name
     LIMIT 200`,
    [filter.q, category],
  );
  return sortByPreference(rankByState(rows, filter.q), prefs, (r) => r.name).slice(0, 50).map(foodOut);
}

export async function getFood(id: string) {
  const { rows } = await pool.query(`SELECT ${FOOD_COLS} FROM foods WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Alimento');
  return foodOut(rows[0]);
}

/**
 * Alimento pelo código de barras. Procura no banco; se não achar, consulta o Open Food Facts e guarda o
 * produto (só com dados completos de macros), então o próximo scan já vem do banco.
 */
export async function findFoodByBarcode(barcode: string) {
  const { rows } = await pool.query(
    `SELECT ${FOOD_COLS} FROM foods WHERE barcode = $1
     ORDER BY (source = 'custom') DESC, (source = 'taco') DESC LIMIT 1`,
    [barcode],
  );
  if (rows[0]) return foodOut(rows[0]);

  const product = await fetchOffProduct(barcode);
  if (!product) throw notFound('Produto');
  return getFood(await upsertOffFood(product));
}

export async function createFood(input: {
  name: string;
  kcalPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
  barcode?: string;
  portions?: Portion[];
}) {
  const { rows } = await pool.query(
    `INSERT INTO foods (name, source, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, barcode, portions)
     VALUES ($1, 'custom', $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING ${FOOD_COLS}`,
    [
      input.name,
      input.kcalPer100g,
      input.proteinPer100g,
      input.carbPer100g,
      input.fatPer100g,
      input.barcode ?? null,
      JSON.stringify(input.portions ?? []),
    ],
  );
  if (!rows[0]) throw new AppError(409, 'food_exists', 'Já existe um alimento personalizado com esse nome');
  return foodOut(rows[0]);
}

/** Corrige/define as porções caseiras de qualquer alimento (as da TACO são estimativas). */
export async function setFoodPortions(id: string, portions: Portion[]) {
  const { rows } = await pool.query(`UPDATE foods SET portions = $2::jsonb WHERE id = $1 RETURNING ${FOOD_COLS}`, [
    id,
    JSON.stringify(portions),
  ]);
  if (!rows[0]) throw notFound('Alimento');
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

export async function insertMeals(db: Db, planId: string, meals: PlanContent['meals']) {
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
            f.id AS food_id, f.name AS food_name, f.source AS food_source, f.category AS food_category, f.kcal_per_100g, f.protein_per_100g, f.carb_per_100g, f.fat_per_100g
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
        food: { id: r.food_id, name: r.food_name, displayName: displayFoodName(r.food_name, r.food_source, r.food_category) },
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

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Café da manhã',
  morning_snack: 'Lanche da manhã',
  lunch: 'Almoço',
  afternoon_snack: 'Lanche da tarde',
  dinner: 'Jantar',
};

/** O tipo antigo 'snack' vira lanche da manhã (antes do meio-dia) ou da tarde, no fuso do app. */
export function normalizeMealType(type: MealInput, at?: string | null): MealType {
  if (type !== 'snack') return type;
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: config.timezone }).format(at ? new Date(at) : new Date()),
  );
  return hour < 12 ? 'morning_snack' : 'afternoon_snack';
}

interface Macros {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

const sumMacros = (items: Macros[]): Macros => {
  const t = items.reduce(
    (a, e) => ({ kcal: a.kcal + e.kcal, proteinG: a.proteinG + e.proteinG, carbG: a.carbG + e.carbG, fatG: a.fatG + e.fatG }),
    { kcal: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );
  return { kcal: round1(t.kcal), proteinG: round1(t.proteinG), carbG: round1(t.carbG), fatG: round1(t.fatG) };
};

/** Gramas a partir de `quantityG` ou de uma porção caseira do alimento (ex.: 2 × "fatia"). */
export function resolveQuantity(
  food: { name: string; portions: Portion[] },
  q: { quantityG?: number; portion?: { label: string; count: number } },
) {
  if (q.quantityG !== undefined) return { quantityG: q.quantityG, portionLabel: null, portionCount: null };

  const wanted = q.portion!.label.toLowerCase();
  const found = food.portions.find((p) => p.label.toLowerCase() === wanted);
  if (!found) {
    const options = food.portions.map((p) => p.label).join(', ') || 'nenhuma cadastrada';
    throw new AppError(400, 'unknown_portion', `"${food.name}" não tem a porção "${q.portion!.label}" (disponíveis: ${options})`);
  }
  const grams = Math.round(found.grams * q.portion!.count * 10) / 10;
  if (grams > 5000) throw new AppError(400, 'quantity_too_large', 'Quantidade acima do limite de 5000 g');
  return { quantityG: grams, portionLabel: found.label, portionCount: q.portion!.count };
}

async function loadEntries(where: string, params: unknown[]) {
  const { rows } = await pool.query(
    `SELECT l.id, l.food_id, l.meal_id, l.meal_type, l.quantity_g, l.portion_label, l.portion_count,
            l.recognition_source, l.logged_at,
            f.name, f.source, f.category, f.kcal_per_100g, f.protein_per_100g, f.carb_per_100g, f.fat_per_100g
     FROM food_logs l JOIN foods f ON f.id = l.food_id
     WHERE ${where}
     ORDER BY l.logged_at, l.id`,
    params,
  );
  return rows.map((r) => {
    const k = Number(r.quantity_g) / 100;
    return {
      id: r.id,
      food: { id: r.food_id, name: r.name, displayName: displayFoodName(r.name, r.source, r.category) },
      mealType: r.meal_type as MealType,
      mealId: r.meal_id,
      quantityG: Number(r.quantity_g),
      portion: r.portion_label ? { label: r.portion_label, count: Number(r.portion_count) } : null,
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
  const { rows: foods } = await pool.query<{ id: string; name: string; portions: Portion[] }>(
    'SELECT id, name, portions FROM foods WHERE id = ANY($1::uuid[])',
    [foodIds],
  );
  if (foods.length !== foodIds.length) throw new AppError(400, 'unknown_food', 'Um ou mais alimentos não existem');
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const resolved = input.items.map((item) => resolveQuantity(foodById.get(item.foodId)!, item));

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
    for (const [i, item] of input.items.entries()) {
      const q = resolved[i];
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO food_logs (user_id, food_id, meal_id, meal_type, quantity_g, portion_label, portion_count,
                                recognition_source, logged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, clock_timestamp())) RETURNING id`,
        [
          auth.sub,
          item.foodId,
          item.mealId ?? null,
          normalizeMealType(item.mealType, input.loggedAt),
          q.quantityG,
          q.portionLabel,
          q.portionCount,
          input.recognitionSource,
          input.loggedAt ?? null,
        ],
      );
      ids.push(rows[0].id);
    }
    await client.query('COMMIT');
    // Mesma ordem dos itens enviados (o SELECT não garante ordem entre horários iguais).
    const loaded = new Map((await loadEntries('l.id = ANY($1::uuid[])', [ids])).map((e) => [e.id, e]));
    return { entries: ids.map((id) => loaded.get(id)!) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Edita um item já registrado: quantidade (g ou porção), refeição do dia ou horário. Só o dono. */
export async function updateLog(auth: Auth, id: string, input: UpdateLogInput) {
  const { rows } = await pool.query<{ food_id: string }>('SELECT food_id FROM food_logs WHERE id = $1 AND user_id = $2', [
    id,
    auth.sub,
  ]);
  if (!rows[0]) throw notFound('Registro');

  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };

  if (input.quantityG !== undefined || input.portion !== undefined) {
    const { rows: foods } = await pool.query<{ name: string; portions: Portion[] }>(
      'SELECT name, portions FROM foods WHERE id = $1',
      [rows[0].food_id],
    );
    const q = resolveQuantity(foods[0], input);
    set('quantity_g', q.quantityG);
    set('portion_label', q.portionLabel);
    set('portion_count', q.portionCount);
  }
  if (input.mealType !== undefined) set('meal_type', normalizeMealType(input.mealType, input.loggedAt));
  if (input.loggedAt !== undefined) set('logged_at', input.loggedAt, '::timestamptz');

  await pool.query(`UPDATE food_logs SET ${sets.join(', ')} WHERE id = $1`, params);
  return (await loadEntries('l.id = $1', [id]))[0];
}

const MACRO_KEYS = ['kcal', 'proteinG', 'carbG', 'fatG'] as const;

/**
 * Resumo do dia (fuso de config.timezone): itens agrupados por refeição (café, lanche da manhã, almoço, lanche da tarde, jantar),
 * totais, e consumido × meta × quanto falta, quando há plano ativo com metas.
 */
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
  const totals = sumMacros(entries);

  const { rows: plans } = await pool.query<PlanRow>(
    `SELECT * FROM diet_plans WHERE patient_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const plan = plans[0];
  // Meta de calorias: a manual do usuário > a de um plano alimentar de nutricionista ou do próprio usuário > a calculada
  // pelo perfil e treinos do dia. A meta fixa do plano gerado pela IA no onboarding NÃO tem prioridade: ela não muda
  // nos dias de treino, então só vale quando faltam dados do perfil para calcular.
  const energy = await computeEnergyTarget(userId, date);
  const planKcal = plan ? num(plan.target_kcal) : null;
  const fixedPlanKcal = plan && plan.source !== 'ai' ? planKcal : null;
  const dynamicKcal = energy.breakdown?.dynamicKcal ?? null;
  const kcalTarget = energy.overrideKcal ?? fixedPlanKcal ?? dynamicKcal ?? planKcal ?? null;
  const kcalSource =
    energy.overrideKcal !== null ? 'override' : fixedPlanKcal !== null ? 'plan' : dynamicKcal !== null ? 'dynamic' : planKcal !== null ? 'plan' : null;
  const targets =
    plan || kcalTarget !== null
      ? {
          kcal: kcalTarget,
          kcalSource,
          proteinG: plan ? num(plan.target_protein_g) : null,
          carbG: plan ? num(plan.target_carb_g) : null,
          fatG: plan ? num(plan.target_fat_g) : null,
        }
      : null;

  const progress = targets
    ? Object.fromEntries(
        MACRO_KEYS.map((k) => {
          const target = targets[k];
          return [
            k,
            target === null
              ? null
              : {
                  consumed: totals[k],
                  target,
                  remaining: round1(target - totals[k]), // negativo = passou da meta
                  percent: Math.round((totals[k] / target) * 100),
                },
          ];
        }),
      )
    : null;

  return {
    date,
    meals: mealTypes.map((type) => {
      const items = entries.filter((e) => e.mealType === type);
      return { type, label: MEAL_LABELS[type], totals: sumMacros(items), entries: items };
    }),
    entries,
    totals,
    targets,
    progress,
    energy,
  };
}

export async function deleteLog(auth: Auth, id: string) {
  const { rowCount } = await pool.query('DELETE FROM food_logs WHERE id = $1 AND user_id = $2', [id, auth.sub]);
  if (!rowCount) throw notFound('Registro');
}
