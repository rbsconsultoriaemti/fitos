import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import type { UpdateProfileInput } from './profile.schemas';

const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * O onboarding aparece enquanto não foi concluído e (a) faltam dados básicos do perfil ou (b) o questionário
 * já foi iniciado (retoma de onde parou). Quem preencheu o perfil pela aba Perfil não é interrompido.
 */
function onboardingNeeded(r: Record<string, unknown>) {
  if (r.onboardingCompletedAt) return false;
  const basicsMissing = !r.birthDate || !r.sex || r.height_cm === null || r.weight_kg === null;
  return basicsMissing || r.onboarding !== null;
}

export async function getProfile(userId: string) {
  const { rows } = await pool.query(
    `SELECT u.name, u.email, to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate", p.sex,
            p.height_cm, p.weight_kg, p.body_fat_pct, p.resting_hr_bpm AS "restingHrBpm",
            p.max_hr_bpm AS "maxHrBpm", p.goal, p.fitness_level AS "fitnessLevel",
            COALESCE(p.restrictions, '{}') AS restrictions,
            p.onboarding, p.onboarding_step AS "onboardingStep", p.onboarding_completed_at AS "onboardingCompletedAt"
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw new AppError(404, 'not_found', 'Usuário não encontrado');
  return {
    name: r.name,
    email: r.email,
    birthDate: r.birthDate,
    sex: r.sex,
    heightCm: num(r.height_cm),
    weightKg: num(r.weight_kg),
    bodyFatPct: num(r.body_fat_pct),
    restingHrBpm: r.restingHrBpm,
    maxHrBpm: r.maxHrBpm,
    goal: r.goal,
    fitnessLevel: r.fitnessLevel,
    restrictions: r.restrictions as string[],
    onboarding: {
      step: (r.onboardingStep as number | null) ?? 1,
      answers: (r.onboarding as Record<string, unknown> | null) ?? {},
      completedAt: r.onboardingCompletedAt as Date | null,
    },
    onboardingNeeded: onboardingNeeded(r),
  };
}

// campo da API -> coluna do banco
const COLUMNS = {
  birthDate: 'birth_date',
  sex: 'sex',
  heightCm: 'height_cm',
  weightKg: 'weight_kg',
  bodyFatPct: 'body_fat_pct',
  restingHrBpm: 'resting_hr_bpm',
  maxHrBpm: 'max_hr_bpm',
  goal: 'goal',
  fitnessLevel: 'fitness_level',
  restrictions: 'restrictions',
} as const;

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const { name, onboarding, ...fields } = input;
  const entries = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter((k) => fields[k] !== undefined);

  const resting = fields.restingHrBpm;
  const max = fields.maxHrBpm;
  if (resting != null && max != null && resting >= max) {
    throw new AppError(400, 'invalid_heart_rate', 'A frequência cardíaca máxima deve ser maior que a de repouso');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (name !== undefined) await client.query('UPDATE users SET name = $2 WHERE id = $1', [userId, name]);
    if (entries.length > 0) {
      const cols = entries.map((k) => COLUMNS[k]);
      const values = entries.map((k) => (k === 'restrictions' ? fields[k] : (fields[k] ?? null)));
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await client.query(
        `INSERT INTO profiles (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (user_id) DO UPDATE SET ${sets}`,
        [userId, ...values],
      );
    }
    if (onboarding) {
      // Respostas novas se somam às anteriores; a etapa de retomada é a última enviada.
      await client.query(
        `INSERT INTO profiles (user_id, onboarding, onboarding_step) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (user_id) DO UPDATE
         SET onboarding = COALESCE(profiles.onboarding, '{}'::jsonb) || EXCLUDED.onboarding,
             onboarding_step = EXCLUDED.onboarding_step`,
        [userId, JSON.stringify(onboarding.answers), onboarding.step],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getProfile(userId);
}
