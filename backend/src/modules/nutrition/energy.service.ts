import { pool } from '../../database/pool';
import { config } from '../../shared/config';

// Meta diária de calorias = TMB (Mifflin-St Jeor) × 1,2 (dia sem treino) + gasto estimado dos treinos registrados no dia
// (musculação: séries feitas × 2,5 min × MET 6 × peso).
// É uma estimativa para orientar, não prescrição: a meta manual do usuário prevalece (ver getDayLog).

const BASE_ACTIVITY = 1.2;
const STRENGTH_MET = 6;
const MINUTES_PER_SET = 2.5; // série + descanso; o log de musculação não guarda a duração do treino
const MAX_EXERCISE_KCAL = 3000;

export interface EnergyTarget {
  /** Meta efetiva: a definida pelo usuário ou, na falta dela, a calculada. null = faltam dados do perfil. */
  kcal: number | null;
  source: 'override' | 'dynamic' | null;
  overrideKcal: number | null;
  /** Campos do perfil que faltam para calcular (weight, height, birthDate, sex). */
  missing: string[];
  /** Partes da meta calculada do dia (TMB × 1,2 + treino); null quando faltam dados. `targetKcal` = `baseKcal` + `workoutKcal`. */
  baseKcal: number | null;
  workoutKcal: number | null;
  workoutDone: boolean;
  targetKcal: number | null;
  /** Cálculo detalhado; null quando faltam dados. */
  breakdown: {
    bmr: number;
    baseKcal: number;
    exerciseKcal: number;
    activityFactor: number; // (base + treino) / TMB
    trainingMinutes: number;
    sessions: number;
    muscleGroups: string[];
    dynamicKcal: number;
  } | null;
}

/** Taxa metabólica basal, Mifflin-St Jeor. Sexo "outro": média das duas constantes. */
export function mifflinStJeor(p: { weightKg: number; heightCm: number; age: number; sex: 'male' | 'female' | 'other' }) {
  const constant = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + constant;
}

function ageOn(birthDate: string, on: string) {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** MET aproximado do cardio pelo nome do exercício; corrida e bike usam a velocidade quando há distância e tempo. */
function cardioMet(name: string, minutes: number, km: number | null) {
  const speed = km && minutes > 0 ? km / (minutes / 60) : null;
  if (/corrida/i.test(name)) return speed ? Math.min(18, Math.max(6, speed)) : 9; // ≈ 1 kcal/kg/km
  if (/bike|spinning|cicl/i.test(name)) {
    if (!speed) return 7;
    return speed < 16 ? 6 : speed < 20 ? 8 : speed < 25 ? 10 : 12;
  }
  if (/caminhada/i.test(name)) return 4;
  if (/remo/i.test(name)) return 7;
  if (/el[ií]ptico/i.test(name)) return 5;
  return 6;
}

interface WorkoutRow {
  log_id: string;
  muscle_group: string;
  name: string;
  reps: string | null;
  sets_done: number;
  duration_done_min: number | null;
  distance_done_km: string | null;
  prescribed_duration_min: number | null;
}

async function dayWorkouts(userId: string, date: string, weightKg: number) {
  const { rows } = await pool.query<WorkoutRow>(
    `SELECT wl.id AS log_id, d.muscle_group, e.name, s.reps, sl.sets_done,
            sl.duration_done_min, sl.distance_done_km, s.duration_min AS prescribed_duration_min
     FROM workout_logs wl
     JOIN workout_days d ON d.id = wl.day_id
     JOIN set_logs sl ON sl.log_id = wl.id
     JOIN workout_sets s ON s.id = sl.set_id
     JOIN exercises e ON e.id = s.exercise_id
     WHERE wl.student_id = $1
       AND wl.performed_at >= ($2::date)::timestamp AT TIME ZONE $3
       AND wl.performed_at <  (($2::date) + 1)::timestamp AT TIME ZONE $3`,
    [userId, date, config.timezone],
  );

  let kcal = 0;
  let minutes = 0;
  for (const r of rows) {
    if (r.reps === null) {
      // Cardio: usa o que foi feito; se só marcou como concluído, o prescrito.
      const min = r.duration_done_min ?? r.prescribed_duration_min ?? 0;
      const km = r.distance_done_km === null ? null : Number(r.distance_done_km);
      minutes += min;
      kcal += cardioMet(r.name, min, km) * weightKg * (min / 60);
    } else {
      const min = r.sets_done * MINUTES_PER_SET;
      minutes += min;
      kcal += STRENGTH_MET * weightKg * (min / 60);
    }
  }
  return {
    kcal: Math.min(Math.round(kcal), MAX_EXERCISE_KCAL),
    minutes: Math.round(minutes),
    sessions: new Set(rows.map((r) => r.log_id)).size,
    muscleGroups: [...new Set(rows.map((r) => r.muscle_group))],
  };
}

export async function computeEnergyTarget(userId: string, date: string): Promise<EnergyTarget> {
  const { rows } = await pool.query(
    `SELECT p.weight_kg, p.height_cm, to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date, p.sex, p.kcal_target_override
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const p = rows[0];
  const overrideKcal: number | null = p?.kcal_target_override ?? null;

  const missing = [
    p?.weight_kg == null && 'weight',
    p?.height_cm == null && 'height',
    p?.birth_date == null && 'birthDate',
    p?.sex == null && 'sex',
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    return { kcal: overrideKcal, source: overrideKcal === null ? null : 'override', overrideKcal, missing, baseKcal: null, workoutKcal: null, workoutDone: false, targetKcal: null, breakdown: null };
  }

  const weightKg = Number(p.weight_kg);
  const bmr = mifflinStJeor({ weightKg, heightCm: Number(p.height_cm), age: ageOn(p.birth_date, date), sex: p.sex });
  const baseKcal = bmr * BASE_ACTIVITY;
  const workout = await dayWorkouts(userId, date, weightKg);
  const dynamicKcal = Math.round(baseKcal + workout.kcal);

  return {
    kcal: overrideKcal ?? dynamicKcal,
    source: overrideKcal === null ? 'dynamic' : 'override',
    overrideKcal,
    missing,
    baseKcal: Math.round(baseKcal),
    workoutKcal: workout.kcal,
    workoutDone: workout.sessions > 0,
    targetKcal: dynamicKcal,
    breakdown: {
      bmr: Math.round(bmr),
      baseKcal: Math.round(baseKcal),
      exerciseKcal: workout.kcal,
      activityFactor: Math.round(((baseKcal + workout.kcal) / bmr) * 100) / 100,
      trainingMinutes: workout.minutes,
      sessions: workout.sessions,
      muscleGroups: workout.muscleGroups,
      dynamicKcal,
    },
  };
}

/** Define (ou, com null, remove) a meta manual de calorias do usuário. */
export async function setEnergyOverride(userId: string, kcal: number | null) {
  await pool.query(
    `INSERT INTO profiles (user_id, kcal_target_override) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET kcal_target_override = EXCLUDED.kcal_target_override`,
    [userId, kcal],
  );
}
