import { PoolClient } from 'pg';
import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { Role } from '../auth/auth.repository';
import { AccessTokenPayload } from '../auth/auth.service';
import { CreateLogInput, CreatePlanInput, PlanContent } from './workout.schemas';

type Auth = AccessTokenPayload;
type Db = Pick<PoolClient, 'query'>;

const notFound = (what: string) => new AppError(404, 'not_found', `${what} não encontrado`);
const num = (v: string | null) => (v === null ? null : Number(v));

// ---------- acesso ----------

// Quem pode prescrever musculação: o professor e os treinadores de corrida/ciclismo.
const PRESCRIBER_ROLES: Role[] = ['trainer', 'running_coach', 'cycling_coach'];
const isPrescriberRole = (role: Role) => PRESCRIBER_ROLES.includes(role);

/** Vínculo ativo do profissional com o aluno em qualquer uma das três tabelas de vínculo. */
async function hasActiveLink(coachId: string, studentId: string, db: Db = pool): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM trainer_student WHERE trainer_id = $1 AND student_id = $2 AND status = 'active')
         OR EXISTS (SELECT 1 FROM running_coach_athlete WHERE running_coach_id = $1 AND athlete_id = $2 AND status = 'active')
         OR EXISTS (SELECT 1 FROM cycling_coach_athlete WHERE cycling_coach_id = $1 AND athlete_id = $2 AND status = 'active')
         AS ok`,
    [coachId, studentId],
  );
  return rows[0].ok;
}

/** O aluno vê os próprios dados; o profissional, os de alunos com vínculo ativo; o admin, tudo. */
async function canAccessStudent(auth: Auth, studentId: string): Promise<boolean> {
  if (auth.role === 'admin' || auth.sub === studentId) return true;
  return isPrescriberRole(auth.role) && hasActiveLink(auth.sub, studentId);
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
    `SELECT id, name, category, muscle_group AS "muscleGroup", equipment, video_url AS "videoUrl", image_urls AS "imageUrls"
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
    `SELECT id, name, category, muscle_group AS "muscleGroup", equipment, video_url AS "videoUrl", image_urls AS "imageUrls"
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

async function assertExercisesExist(db: Db, days: PlanContent['days']) {
  const exerciseIds = [...new Set(days.flatMap((d) => d.sets.map((s) => s.exerciseId)))];
  const { rows } = await db.query<{ id: string }>('SELECT id FROM exercises WHERE id = ANY($1::uuid[])', [
    exerciseIds,
  ]);
  if (rows.length !== exerciseIds.length) {
    throw new AppError(400, 'unknown_exercise', 'Um ou mais exercícios não existem');
  }
}

async function insertContent(db: Db, planId: string, days: PlanContent['days']) {
  await assertExercisesExist(db, days);

  for (const day of days) {
    const { rows: dayRows } = await db.query<{ id: string }>(
      `INSERT INTO workout_days (plan_id, day_of_week, muscle_group, notes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [planId, day.dayOfWeek, day.muscleGroup, day.notes ?? null],
    );
    for (const [index, set] of day.sets.entries()) {
      await db.query(
        `INSERT INTO workout_sets (day_id, exercise_id, sets, reps, load_kg, rest_seconds, duration_min, distance_km, "order")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          dayRows[0].id,
          set.exerciseId,
          set.sets,
          set.reps ?? null,
          set.loadKg ?? null,
          set.restSeconds ?? null,
          set.durationMin ?? null,
          set.distanceKm ?? null,
          index + 1,
        ],
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
  if (plan.prescribed_by === auth.sub && isPrescriberRole(auth.role) && (await hasActiveLink(auth.sub, plan.owner_id))) {
    return;
  }
  throw notFound('Plano');
}

function assertPrescriber(auth: Auth, plan: PlanRow) {
  if (plan.prescribed_by !== auth.sub || !isPrescriberRole(auth.role)) throw notFound('Plano');
}

async function buildPlan(plan: PlanRow) {
  const { rows } = await pool.query(
    `SELECT d.id AS day_id, d.day_of_week, d.muscle_group AS day_muscle_group, d.notes,
            s.id AS set_id, s.sets, s.reps, s.load_kg, s.rest_seconds, s.duration_min, s.distance_km, s."order",
            e.id AS exercise_id, e.name AS exercise_name, e.video_url, e.image_urls, e.category AS exercise_category
     FROM workout_days d
     LEFT JOIN workout_sets s ON s.day_id = d.id AND NOT s.archived
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
        exercise: { id: r.exercise_id, name: r.exercise_name, videoUrl: r.video_url, imageUrls: r.image_urls, category: r.exercise_category },
        sets: r.sets,
        reps: r.reps,
        loadKg: num(r.load_kg),
        restSeconds: r.rest_seconds,
        durationMin: r.duration_min,
        distanceKm: num(r.distance_km),
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

  if (isPrescriberRole(auth.role)) {
    if (!input.studentId) throw new AppError(400, 'student_required', 'Informe studentId');
    if (!(await hasActiveLink(auth.sub, input.studentId))) {
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

  if (isPrescriberRole(auth.role)) {
    add('p.prescribed_by = ?', auth.sub);
    where.push(
      `(EXISTS (SELECT 1 FROM trainer_student x
                WHERE x.trainer_id = p.prescribed_by AND x.student_id = p.owner_id AND x.status = 'active')
        OR EXISTS (SELECT 1 FROM running_coach_athlete x
                   WHERE x.running_coach_id = p.prescribed_by AND x.athlete_id = p.owner_id AND x.status = 'active')
        OR EXISTS (SELECT 1 FROM cycling_coach_athlete x
                   WHERE x.cycling_coach_id = p.prescribed_by AND x.athlete_id = p.owner_id AND x.status = 'active'))`,
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

const hasHistory = () =>
  new AppError(
    409,
    'has_history',
    'Este dia/série já tem execuções registradas e não pode ser removido; mantenha-o ou arquive o plano e crie outro',
  );

/**
 * Sincroniza o conteúdo de um plano que já pode ter logs, sem apagar histórico:
 * dias são casados por `dayOfWeek`, séries por `id` (opcional; sem id = série nova).
 * Remover um dia/série que já tem execuções é recusado (as FKs apagariam o histórico em cascata).
 */
async function syncContent(db: Db, planId: string, days: PlanContent['days']) {
  await assertExercisesExist(db, days);

  const { rows: existingDays } = await db.query<{ id: string; day_of_week: number }>(
    'SELECT id, day_of_week FROM workout_days WHERE plan_id = $1',
    [planId],
  );
  const byWeekday = new Map(existingDays.map((d) => [d.day_of_week, d.id]));
  const keptWeekdays = new Set(days.map((d) => d.dayOfWeek));

  for (const d of existingDays) {
    if (keptWeekdays.has(d.day_of_week)) continue;
    const { rowCount } = await db.query('SELECT 1 FROM workout_logs WHERE day_id = $1 LIMIT 1', [d.id]);
    if (rowCount) throw hasHistory();
    await db.query('DELETE FROM workout_days WHERE id = $1', [d.id]);
  }

  for (const day of days) {
    let dayId = byWeekday.get(day.dayOfWeek);
    if (dayId) {
      await db.query('UPDATE workout_days SET muscle_group = $2, notes = $3 WHERE id = $1', [
        dayId,
        day.muscleGroup,
        day.notes ?? null,
      ]);
    } else {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO workout_days (plan_id, day_of_week, muscle_group, notes) VALUES ($1, $2, $3, $4) RETURNING id`,
        [planId, day.dayOfWeek, day.muscleGroup, day.notes ?? null],
      );
      dayId = rows[0].id;
    }

    const { rows: existingSets } = await db.query<{ id: string; exercise_id: string }>(
      'SELECT id, exercise_id FROM workout_sets WHERE day_id = $1 AND NOT archived',
      [dayId],
    );
    const existing = new Map(existingSets.map((s) => [s.id, s.exercise_id]));
    const keptIds = new Set<string>();
    // Trocar o exercício = tirar a série antiga (arquiva se tiver histórico) e criar uma nova no mesmo lugar.
    const items = day.sets.map((s) => {
      if (!s.id) return s;
      if (!existing.has(s.id)) throw new AppError(400, 'invalid_set', 'Série não pertence a este dia do plano');
      if (keptIds.has(s.id)) throw new AppError(400, 'duplicate_set', 'Série repetida');
      if (existing.get(s.id) !== s.exerciseId) return { ...s, id: undefined };
      keptIds.add(s.id);
      return s;
    });

    for (const removedId of existing.keys()) {
      if (keptIds.has(removedId)) continue;
      const { rowCount } = await db.query('SELECT 1 FROM set_logs WHERE set_id = $1 LIMIT 1', [removedId]);
      if (rowCount) {
        // Tem histórico: arquiva (some do plano, continua nos logs) e sai da faixa de ordens em uso.
        await db.query(
          `UPDATE workout_sets SET archived = true,
             "order" = (SELECT GREATEST(COALESCE(MAX("order"), 0), 100000) + 1 FROM workout_sets WHERE day_id = $2)
           WHERE id = $1`,
          [removedId, dayId],
        );
      } else {
        await db.query('DELETE FROM workout_sets WHERE id = $1', [removedId]);
      }
    }

    // UNIQUE (day_id, "order"): afasta as ordens atuais antes de reatribuir.
    await db.query(`UPDATE workout_sets SET "order" = "order" + 10000 WHERE day_id = $1 AND NOT archived`, [dayId]);
    for (const [index, s] of items.entries()) {
      const values = [
        s.sets,
        s.reps ?? null,
        s.loadKg ?? null,
        s.restSeconds ?? null,
        s.durationMin ?? null,
        s.distanceKm ?? null,
        index + 1,
      ];
      if (s.id) {
        await db.query(
          `UPDATE workout_sets SET sets = $2, reps = $3, load_kg = $4, rest_seconds = $5,
                  duration_min = $6, distance_km = $7, "order" = $8 WHERE id = $1`,
          [s.id, ...values],
        );
      } else {
        await db.query(
          `INSERT INTO workout_sets (day_id, exercise_id, sets, reps, load_kg, rest_seconds, duration_min, distance_km, "order")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [dayId, s.exerciseId, ...values],
        );
      }
    }
  }
}

/**
 * Plano `self` (do próprio aluno): editável a qualquer momento, inclusive ativo, preservando o histórico.
 * Demais planos: só o prescritor, e só enquanto rascunho (depois de aprovado fica imutável).
 */
export async function updatePlan(auth: Auth, id: string, content: PlanContent) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<PlanRow>('SELECT * FROM workout_plans WHERE id = $1 FOR UPDATE', [id]);
    const plan = rows[0];
    if (!plan) throw notFound('Plano');

    const isSelf = plan.source === 'self';
    if (isSelf) {
      if (plan.owner_id !== auth.sub) throw notFound('Plano');
      if (plan.status === 'archived') throw new AppError(409, 'plan_archived', 'Plano arquivado não pode ser editado');
    } else {
      assertPrescriber(auth, plan);
      if (plan.status !== 'draft') {
        throw new AppError(409, 'plan_not_draft', 'Só rascunhos podem ser editados');
      }
    }

    await client.query('UPDATE workout_plans SET title = $2, duration_weeks = $3 WHERE id = $1', [
      id,
      content.title,
      content.durationWeeks ?? null,
    ]);
    if (isSelf) {
      await syncContent(client, id, content.days);
    } else {
      // Rascunho nunca tem logs, então pode ser reescrito por completo.
      await client.query('DELETE FROM workout_days WHERE plan_id = $1', [id]);
      await insertContent(client, id, content.days);
    }
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
  if (!(await hasActiveLink(auth.sub, plan.owner_id))) {
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
        `INSERT INTO set_logs (log_id, set_id, sets_done, load_done_kg, reps_done, duration_done_min, distance_done_km)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          rows[0].id,
          s.setId,
          s.setsDone,
          s.loadDoneKg ?? null,
          s.repsDone ?? null,
          s.durationDoneMin ?? null,
          s.distanceDoneKm ?? null,
        ],
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
            s.duration_min AS prescribed_duration_min, s.distance_km AS prescribed_distance_km,
            sl.sets_done, sl.reps_done, sl.load_done_kg, sl.duration_done_min, sl.distance_done_km
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
      prescribed: {
        sets: r.prescribed_sets,
        reps: r.prescribed_reps,
        loadKg: num(r.prescribed_load_kg),
        durationMin: r.prescribed_duration_min,
        distanceKm: num(r.prescribed_distance_km),
      },
      done: {
        sets: r.sets_done,
        reps: r.reps_done,
        loadKg: num(r.load_done_kg),
        durationMin: r.duration_done_min,
        distanceKm: num(r.distance_done_km),
      },
    })),
  };
}

export async function listLogs(auth: Auth, filter: { studentId?: string; planId?: string }) {
  const studentId = filter.studentId ?? (auth.role === 'student' ? auth.sub : undefined);
  if (!studentId) throw new AppError(400, 'student_required', 'Informe studentId');
  if (!(await canAccessStudent(auth, studentId))) throw notFound('Aluno');

  // Resumo por treino (séries, volume e cardio) para o histórico/estatísticas do app.
  const { rows } = await pool.query(
    `SELECT l.id, l.plan_id AS "planId", l.day_id AS "dayId", l.performed_at AS "performedAt",
            l.perceived_effort AS "perceivedEffort", l.notes,
            d.day_of_week AS "dayOfWeek", d.muscle_group AS "muscleGroup",
            COALESCE(SUM(sl.sets_done), 0)::int AS "setsDone",
            COALESCE(SUM(sl.sets_done * sl.reps_done * sl.load_done_kg), 0)::float8 AS "volumeKg",
            COALESCE(SUM(sl.distance_done_km), 0)::float8 AS "distanceKm",
            COALESCE(SUM(sl.duration_done_min), 0)::int AS "durationMin"
     FROM workout_logs l
     LEFT JOIN workout_days d ON d.id = l.day_id
     LEFT JOIN set_logs sl ON sl.log_id = l.id
     WHERE l.student_id = $1 AND ($2::uuid IS NULL OR l.plan_id = $2)
     GROUP BY l.id, d.id
     ORDER BY l.performed_at DESC
     LIMIT 200`,
    [studentId, filter.planId ?? null],
  );
  return rows;
}
