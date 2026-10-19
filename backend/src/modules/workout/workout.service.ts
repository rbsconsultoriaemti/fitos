import { PoolClient } from 'pg';
import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { AccessTokenPayload } from '../auth/auth.service';
import { CreateLogInput, CreatePlanInput, PlanContent } from './workout.schemas';

type Auth = AccessTokenPayload;
type Db = Pick<PoolClient, 'query'>;

const notFound = (what: string) => new AppError(404, 'not_found', `${what} não encontrado`);
const num = (v: string | null) => (v === null ? null : Number(v));

// ---------- acesso ----------

async function isLinkedTrainer(trainerId: string, studentId: string, db: Db = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM trainer_student WHERE trainer_id = $1 AND student_id = $2 AND status = 'active'`,
    [trainerId, studentId],
  );
  return (rowCount ?? 0) > 0;
}

/** O aluno vê os próprios dados; o professor, os de alunos com vínculo ativo; o admin, tudo. */
async function canAccessStudent(auth: Auth, studentId: string): Promise<boolean> {
  if (auth.role === 'admin' || auth.sub === studentId) return true;
  return auth.role === 'trainer' && isLinkedTrainer(auth.sub, studentId);
}

// ---------- exercícios ----------

export async function createExercise(input: {
  name: string;
  category: string;
  muscleGroup: string;
  equipment?: string;
  videoUrl?: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO exercises (name, category, muscle_group, equipment, video_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id, name, category, muscle_group AS "muscleGroup", equipment, video_url AS "videoUrl"`,
    [input.name, input.category, input.muscleGroup, input.equipment ?? null, input.videoUrl ?? null],
  );
  if (!rows[0]) throw new AppError(409, 'exercise_exists', 'Já existe um exercício com esse nome');
  return rows[0];
}

export async function listExercises(filter: { q?: string; muscleGroup?: string }) {
  const { rows } = await pool.query(
    `SELECT id, name, category, muscle_group AS "muscleGroup", equipment, video_url AS "videoUrl"
     FROM exercises
     WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR lower(muscle_group) = lower($2))
     ORDER BY name
     LIMIT 200`,
    [filter.q ?? null, filter.muscleGroup ?? null],
  );
  return rows;
}

export async function getExercise(id: string) {
  const { rows } = await pool.query(
    `SELECT id, name, category, muscle_group AS "muscleGroup", equipment, video_url AS "videoUrl"
     FROM exercises WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Exercício');
  return rows[0];
}

// ---------- planos ----------

interface PlanRow {
  id: string;
  owner_id: string;
  prescribed_by: string | null;
  title: string;
  source: 'ai' | 'trainer' | 'self';
  status: 'draft' | 'active' | 'archived';
  duration_weeks: number | null;
  created_at: Date;
}

async function insertContent(db: Db, planId: string, days: PlanContent['days']) {
  const exerciseIds = [...new Set(days.flatMap((d) => d.sets.map((s) => s.exerciseId)))];
  const { rows } = await db.query<{ id: string }>('SELECT id FROM exercises WHERE id = ANY($1::uuid[])', [
    exerciseIds,
  ]);
  if (rows.length !== exerciseIds.length) {
    throw new AppError(400, 'unknown_exercise', 'Um ou mais exercícios não existem');
  }

  for (const day of days) {
    const { rows: dayRows } = await db.query<{ id: string }>(
      `INSERT INTO workout_days (plan_id, day_of_week, muscle_group, notes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [planId, day.dayOfWeek, day.muscleGroup, day.notes ?? null],
    );
    for (const [index, set] of day.sets.entries()) {
      await db.query(
        `INSERT INTO workout_sets (day_id, exercise_id, sets, reps, load_kg, rest_seconds, "order")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [dayRows[0].id, set.exerciseId, set.sets, set.reps, set.loadKg ?? null, set.restSeconds ?? null, index + 1],
      );
    }
  }
}

async function loadPlanRow(id: string, db: Db = pool): Promise<PlanRow | null> {
  const { rows } = await db.query<PlanRow>('SELECT * FROM workout_plans WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/** Quem pode ver o plano. Rascunho só é visível ao profissional que o prescreveu (e ao admin). */
async function assertCanView(auth: Auth, plan: PlanRow) {
  if (auth.role === 'admin') return;
  if (plan.owner_id === auth.sub) {
    if (plan.status === 'draft' && plan.source !== 'self') throw notFound('Plano');
    return;
  }
  if (plan.prescribed_by === auth.sub && auth.role === 'trainer' && (await isLinkedTrainer(auth.sub, plan.owner_id))) {
    return;
  }
  throw notFound('Plano');
}

function assertPrescriber(auth: Auth, plan: PlanRow) {
  if (plan.prescribed_by !== auth.sub || auth.role !== 'trainer') throw notFound('Plano');
}

async function buildPlan(plan: PlanRow) {
  const { rows } = await pool.query(
    `SELECT d.id AS day_id, d.day_of_week, d.muscle_group AS day_muscle_group, d.notes,
            s.id AS set_id, s.sets, s.reps, s.load_kg, s.rest_seconds, s."order",
            e.id AS exercise_id, e.name AS exercise_name, e.video_url
     FROM workout_days d
     LEFT JOIN workout_sets s ON s.day_id = d.id
     LEFT JOIN exercises e ON e.id = s.exercise_id
     WHERE d.plan_id = $1
     ORDER BY d.day_of_week, s."order"`,
    [plan.id],
  );

  const days = new Map<string, any>();
  for (const r of rows) {
    if (!days.has(r.day_id)) {
      days.set(r.day_id, {
        id: r.day_id,
        dayOfWeek: r.day_of_week,
        muscleGroup: r.day_muscle_group,
        notes: r.notes,
        sets: [],
      });
    }
    if (r.set_id) {
      days.get(r.day_id).sets.push({
        id: r.set_id,
        order: r.order,
        exercise: { id: r.exercise_id, name: r.exercise_name, videoUrl: r.video_url },
        sets: r.sets,
        reps: r.reps,
        loadKg: num(r.load_kg),
        restSeconds: r.rest_seconds,
      });
    }
  }

  return {
    id: plan.id,
    ownerId: plan.owner_id,
    prescribedBy: plan.prescribed_by,
    title: plan.title,
    source: plan.source,
    status: plan.status,
    durationWeeks: plan.duration_weeks,
    createdAt: plan.created_at,
    days: [...days.values()],
  };
}

export async function createPlan(auth: Auth, input: CreatePlanInput) {
  let ownerId: string;
  let prescribedBy: string | null;
  let source: 'trainer' | 'self';
  let status: 'draft' | 'active';

  if (auth.role === 'trainer') {
    if (!input.studentId) throw new AppError(400, 'student_required', 'Informe studentId');
    if (!(await isLinkedTrainer(auth.sub, input.studentId))) {
      throw new AppError(403, 'not_linked', 'Você não tem vínculo ativo com este aluno');
    }
    // Fluxo de prescrição: nasce como rascunho e só chega ao aluno após aprovação.
    ownerId = input.studentId;
    prescribedBy = auth.sub;
    source = 'trainer';
    status = 'draft';
  } else if (auth.role === 'student') {
    ownerId = auth.sub;
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
      `INSERT INTO workout_plans (owner_id, prescribed_by, title, source, status, duration_weeks)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [ownerId, prescribedBy, input.title, source, status, input.durationWeeks ?? null],
    );
    await insertContent(client, rows[0].id, input.days);
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

export async function listPlans(auth: Auth, filter: { studentId?: string; status?: string }) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (auth.role === 'trainer') {
    add('p.prescribed_by = ?', auth.sub);
    where.push(
      `EXISTS (SELECT 1 FROM trainer_student ts
               WHERE ts.trainer_id = p.prescribed_by AND ts.student_id = p.owner_id AND ts.status = 'active')`,
    );
    if (filter.studentId) add('p.owner_id = ?', filter.studentId);
  } else if (auth.role === 'admin') {
    if (filter.studentId) add('p.owner_id = ?', filter.studentId);
  } else {
    add('p.owner_id = ?', auth.sub);
    where.push(`NOT (p.status = 'draft' AND p.source <> 'self')`);
  }
  if (filter.status) add('p.status = ?', filter.status);

  const { rows } = await pool.query(
    `SELECT p.id, p.owner_id AS "ownerId", p.prescribed_by AS "prescribedBy", p.title, p.source, p.status,
            p.duration_weeks AS "durationWeeks", p.created_at AS "createdAt"
     FROM workout_plans p
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.created_at DESC
     LIMIT 100`,
    params,
  );
  return rows;
}

/** Edita o conteúdo de um rascunho. Planos ativos não mudam: os logs referenciam suas séries. */
export async function updatePlan(auth: Auth, id: string, content: PlanContent) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<PlanRow>('SELECT * FROM workout_plans WHERE id = $1 FOR UPDATE', [id]);
    const plan = rows[0];
    if (!plan) throw notFound('Plano');
    assertPrescriber(auth, plan);
    if (plan.status !== 'draft') {
      throw new AppError(409, 'plan_not_draft', 'Só rascunhos podem ser editados');
    }

    await client.query('UPDATE workout_plans SET title = $2, duration_weeks = $3 WHERE id = $1', [
      id,
      content.title,
      content.durationWeeks ?? null,
    ]);
    await client.query('DELETE FROM workout_days WHERE plan_id = $1', [id]);
    await insertContent(client, id, content.days);
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
  if (!(await isLinkedTrainer(auth.sub, plan.owner_id))) {
    throw new AppError(403, 'not_linked', 'Você não tem vínculo ativo com este aluno');
  }
  const { rowCount } = await pool.query(
    `UPDATE workout_plans SET status = 'active' WHERE id = $1 AND status = 'draft'`,
    [id],
  );
  if (!rowCount) throw new AppError(409, 'plan_not_draft', 'Só rascunhos podem ser aprovados');
  return getPlan(auth, id);
}

export async function archivePlan(auth: Auth, id: string) {
  const plan = await loadPlanRow(id);
  if (!plan) throw notFound('Plano');
  const isSelfOwner = plan.source === 'self' && plan.owner_id === auth.sub;
  if (!isSelfOwner) assertPrescriber(auth, plan);
  await pool.query(`UPDATE workout_plans SET status = 'archived' WHERE id = $1`, [id]);
  return getPlan(auth, id);
}

// ---------- logs de execução ----------

export async function createLog(auth: Auth, input: CreateLogInput) {
  const plan = await loadPlanRow(input.planId);
  if (!plan || plan.owner_id !== auth.sub) throw notFound('Plano');
  if (plan.status !== 'active') throw new AppError(409, 'plan_not_active', 'O plano não está ativo');

  const { rows: days } = await pool.query('SELECT 1 FROM workout_days WHERE id = $1 AND plan_id = $2', [
    input.dayId,
    plan.id,
  ]);
  if (days.length === 0) throw new AppError(400, 'invalid_day', 'O dia não pertence ao plano');

  const setIds = input.sets.map((s) => s.setId);
  if (new Set(setIds).size !== setIds.length) {
    throw new AppError(400, 'duplicate_set', 'Série repetida no log');
  }
  const { rows: valid } = await pool.query('SELECT id FROM workout_sets WHERE day_id = $1 AND id = ANY($2::uuid[])', [
    input.dayId,
    setIds,
  ]);
  if (valid.length !== setIds.length) {
    throw new AppError(400, 'invalid_set', 'Uma ou mais séries não pertencem ao dia informado');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO workout_logs (student_id, plan_id, day_id, performed_at, perceived_effort, notes)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6) RETURNING id`,
      [auth.sub, plan.id, input.dayId, input.performedAt ?? null, input.perceivedEffort ?? null, input.notes ?? null],
    );
    for (const s of input.sets) {
      await client.query(
        `INSERT INTO set_logs (log_id, set_id, sets_done, load_done_kg, reps_done) VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, s.setId, s.setsDone, s.loadDoneKg ?? null, s.repsDone ?? null],
      );
    }
    await client.query('COMMIT');
    return await getLog(auth, rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Log com prescrito vs executado, série a série. */
export async function getLog(auth: Auth, id: string) {
  const { rows: logs } = await pool.query(
    `SELECT l.id, l.student_id, l.plan_id, l.day_id, l.performed_at, l.perceived_effort, l.notes
     FROM workout_logs l WHERE l.id = $1`,
    [id],
  );
  const log = logs[0];
  if (!log || !(await canAccessStudent(auth, log.student_id))) throw notFound('Log');

  const { rows } = await pool.query(
    `SELECT s.id AS set_id, s."order", e.name AS exercise_name,
            s.sets AS prescribed_sets, s.reps AS prescribed_reps, s.load_kg AS prescribed_load_kg,
            sl.sets_done, sl.reps_done, sl.load_done_kg
     FROM set_logs sl
     JOIN workout_sets s ON s.id = sl.set_id
     JOIN exercises e ON e.id = s.exercise_id
     WHERE sl.log_id = $1
     ORDER BY s."order"`,
    [id],
  );

  return {
    id: log.id,
    studentId: log.student_id,
    planId: log.plan_id,
    dayId: log.day_id,
    performedAt: log.performed_at,
    perceivedEffort: log.perceived_effort,
    notes: log.notes,
    sets: rows.map((r) => ({
      setId: r.set_id,
      exercise: r.exercise_name,
      prescribed: { sets: r.prescribed_sets, reps: r.prescribed_reps, loadKg: num(r.prescribed_load_kg) },
      done: { sets: r.sets_done, reps: r.reps_done, loadKg: num(r.load_done_kg) },
    })),
  };
}

export async function listLogs(auth: Auth, filter: { studentId?: string; planId?: string }) {
  const studentId = filter.studentId ?? (auth.role === 'student' ? auth.sub : undefined);
  if (!studentId) throw new AppError(400, 'student_required', 'Informe studentId');
  if (!(await canAccessStudent(auth, studentId))) throw notFound('Aluno');

  const { rows } = await pool.query(
    `SELECT id, plan_id AS "planId", day_id AS "dayId", performed_at AS "performedAt",
            perceived_effort AS "perceivedEffort", notes
     FROM workout_logs
     WHERE student_id = $1 AND ($2::uuid IS NULL OR plan_id = $2)
     ORDER BY performed_at DESC
     LIMIT 100`,
    [studentId, filter.planId ?? null],
  );
  return rows;
}
