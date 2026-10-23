import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { GOAL_LABELS } from '../onboarding/onboarding.schemas';
import { activePlanFor } from '../workout/workout.service';
import { ADHERENCE_WEEKS, streak, STREAK_MIN, todayIn, todayStatus, weeklyAdherence, type PlanInfo } from './trainer.logic';

const bmiCategory = (bmi: number) => (bmi < 18.5 ? 'abaixo do peso' : bmi < 25 ? 'peso adequado' : bmi < 30 ? 'sobrepeso' : 'obesidade');
const round1 = (n: number) => Math.round(n * 10) / 10;

const goalOf = (goal: string | null, goalKey: string | null) =>
  goal?.trim() || (goalKey && goalKey in GOAL_LABELS ? GOAL_LABELS[goalKey as keyof typeof GOAL_LABELS] : null);

interface StudentRow {
  id: string;
  name: string;
  goal: string | null;
  goal_key: string | null;
  fitness_level: string | null;
  linked_at: Date;
}

async function linkedStudents(trainerId: string, onlyId?: string): Promise<StudentRow[]> {
  const { rows } = await pool.query<StudentRow>(
    `SELECT u.id, u.name, p.goal, p.onboarding->>'goalKey' AS goal_key, p.fitness_level, ts.linked_at
     FROM trainer_student ts
     JOIN users u ON u.id = ts.student_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE ts.trainer_id = $1 AND ts.status = 'active' AND ($2::uuid IS NULL OR u.id = $2)
     ORDER BY lower(u.name)`,
    [trainerId, onlyId ?? null],
  );
  return rows;
}

/** Plano ativo (o mais recente) e dias de treino de cada aluno, e as datas locais com treino registrado. */
async function trainingData(studentIds: string[]) {
  const [{ rows: plans }, { rows: logs }] = await Promise.all([
    pool.query<{ owner_id: string; created: string; weekdays: number[] }>(
      `SELECT DISTINCT ON (p.owner_id) p.owner_id, to_char(p.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS created,
              ARRAY(SELECT d.day_of_week FROM workout_days d WHERE d.plan_id = p.id) AS weekdays
       FROM workout_plans p
       WHERE p.owner_id = ANY($1::uuid[]) AND p.status = 'active'
       ORDER BY p.owner_id, (p.source = 'trainer') DESC, p.created_at DESC`,
      [studentIds, config.timezone],
    ),
    pool.query<{ student_id: string; day: string }>(
      `SELECT DISTINCT student_id, to_char(performed_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day
       FROM workout_logs
       WHERE student_id = ANY($1::uuid[]) AND performed_at >= now() - interval '400 days'`,
      [studentIds, config.timezone],
    ),
  ]);
  const planBy = new Map<string, PlanInfo>(plans.map((p) => [p.owner_id, { startDate: p.created, weekdays: new Set(p.weekdays) }]));
  const logsBy = new Map<string, Set<string>>();
  for (const l of logs) logsBy.set(l.student_id, (logsBy.get(l.student_id) ?? new Set()).add(l.day));
  return { planBy, logsBy };
}

export async function listStudents(trainerId: string) {
  const students = await linkedStudents(trainerId);
  const today = todayIn(config.timezone);
  const { planBy, logsBy } = await trainingData(students.map((s) => s.id));

  const items = students.map((s) => {
    const plan = planBy.get(s.id) ?? null;
    const dates = logsBy.get(s.id) ?? new Set<string>();
    const run = streak(plan, dates, today);
    return {
      id: s.id,
      name: s.name,
      goal: goalOf(s.goal, s.goal_key),
      fitnessLevel: s.fitness_level,
      todayStatus: todayStatus(plan, dates, today),
      streak: run,
      onStreak: run >= STREAK_MIN,
      lastWorkoutDate: [...dates].sort().pop() ?? null,
    };
  });
  return {
    date: today,
    summary: {
      total: items.length,
      trainedToday: items.filter((i) => i.todayStatus === 'trained').length,
      onStreak: items.filter((i) => i.onStreak).length,
      streakMin: STREAK_MIN,
    },
    students: items,
  };
}

export async function studentDetail(trainerId: string, studentId: string) {
  const [student] = await linkedStudents(trainerId, studentId);
  if (!student) throw new AppError(404, 'not_found', 'Aluno não encontrado');

  const today = todayIn(config.timezone);
  const [{ planBy, logsBy }, { rows: prof }, plan, { rows: logRows }] = await Promise.all([
    trainingData([studentId]),
    pool.query(`SELECT height_cm, weight_kg, extract(year FROM age(birth_date))::int AS age FROM profiles WHERE user_id = $1`, [studentId]),
    activePlanFor(studentId),
    pool.query(
      `SELECT l.id, l.performed_at, to_char(l.performed_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
              l.perceived_effort, d.muscle_group, d.day_of_week,
              COALESCE((SELECT SUM(sl.sets_done) FROM set_logs sl WHERE sl.log_id = l.id), 0)::int AS sets_done,
              COALESCE((SELECT SUM(s.sets) FROM workout_sets s WHERE s.day_id = l.day_id AND NOT s.archived), 0)::int AS sets_prescribed
       FROM workout_logs l
       LEFT JOIN workout_days d ON d.id = l.day_id
       WHERE l.student_id = $1
       ORDER BY l.performed_at DESC
       LIMIT 7`,
      [studentId, config.timezone],
    ),
  ]);

  const planInfo = planBy.get(studentId) ?? null;
  const dates = logsBy.get(studentId) ?? new Set<string>();
  const h = prof[0]?.height_cm ? Number(prof[0].height_cm) : null;
  const w = prof[0]?.weight_kg ? Number(prof[0].weight_kg) : null;
  const bmi = h && w ? round1(w / (h / 100) ** 2) : null;

  return {
    student: {
      id: student.id,
      name: student.name,
      goal: goalOf(student.goal, student.goal_key),
      fitnessLevel: student.fitness_level,
      age: prof[0]?.age ?? null,
      heightCm: h,
      weightKg: w,
      bmi,
      bmiCategory: bmi ? bmiCategory(bmi) : null,
      linkedAt: student.linked_at,
    },
    todayStatus: todayStatus(planInfo, dates, today),
    streak: streak(planInfo, dates, today),
    plan,
    recentLogs: logRows.map((r) => ({
      id: r.id,
      performedAt: r.performed_at,
      date: r.day,
      muscleGroup: r.muscle_group,
      setsDone: r.sets_done,
      setsPrescribed: r.sets_prescribed,
      adherencePct: r.sets_prescribed > 0 ? Math.min(100, Math.round((r.sets_done / r.sets_prescribed) * 100)) : null,
      perceivedEffort: r.perceived_effort,
    })),
    weeklyAdherence: weeklyAdherence(planInfo, dates, today, ADHERENCE_WEEKS),
  };
}
