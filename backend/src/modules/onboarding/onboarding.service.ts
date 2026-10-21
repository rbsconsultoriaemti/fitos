import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { insertPlanContent } from '../workout/workout.service';
import { computeNutritionTargets } from './nutrition-targets';
import { completeAnswersSchema } from './onboarding.schemas';
import { generateWorkoutPlan } from './plan-generator';

// Cada geração custa uma chamada à Claude API: no máximo uma por usuário a cada 60 s (e nunca duas ao mesmo tempo).
const COOLDOWN_MS = 60_000;
const lastStart = new Map<string, number>();

const ageOf = (birthDate: string) => {
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
};

/**
 * Fecha o onboarding: calcula a meta calórica/macros, pede o plano de treino à Claude API,
 * grava o plano (ativo, source 'ai') e as metas (plano alimentar 'ai') e marca o onboarding como concluído.
 */
export async function completeOnboarding(userId: string) {
  const { rows } = await pool.query(
    `SELECT to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date, p.sex, p.height_cm, p.weight_kg,
            p.fitness_level, p.onboarding
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw new AppError(404, 'not_found', 'Usuário não encontrado');

  const missing: string[] = [];
  if (!r.birth_date) missing.push('birthDate');
  if (!r.sex) missing.push('sex');
  if (r.height_cm === null || r.height_cm === undefined) missing.push('heightCm');
  if (r.weight_kg === null || r.weight_kg === undefined) missing.push('weightKg');
  if (!r.fitness_level) missing.push('fitnessLevel');
  const answers = completeAnswersSchema.safeParse(r.onboarding ?? {});
  if (!answers.success) missing.push(...answers.error.issues.map((i) => String(i.path[0])));
  if (missing.length > 0 || !answers.success) {
    throw new AppError(400, 'onboarding_incomplete', `Faltam respostas: ${[...new Set(missing)].join(', ')}`);
  }

  const now = Date.now();
  if (now - (lastStart.get(userId) ?? 0) < COOLDOWN_MS) {
    throw new AppError(429, 'too_many_requests', 'Aguarde um minuto antes de gerar o plano novamente');
  }
  lastStart.set(userId, now);

  try {
    const age = ageOf(r.birth_date);
    const weightKg = Number(r.weight_kg);
    const heightCm = Number(r.height_cm);
    const nutrition = computeNutritionTargets({
      weightKg,
      heightCm,
      age,
      sex: r.sex,
      goal: answers.data.goalKey,
      daysPerWeek: answers.data.daysPerWeek,
      sessionMinutes: answers.data.sessionMinutes,
    });

    const generated = await generateWorkoutPlan({
      age,
      sex: r.sex,
      weightKg,
      heightCm,
      level: r.fitness_level,
      answers: answers.data,
      nutrition,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Planos gerados antes pela IA saem de cena; planos próprios ou de profissionais não são tocados.
      await client.query(`UPDATE workout_plans SET status = 'archived' WHERE owner_id = $1 AND source = 'ai' AND status = 'active'`, [userId]);
      const { rows: plan } = await client.query<{ id: string }>(
        `INSERT INTO workout_plans (owner_id, prescribed_by, title, source, status, duration_weeks)
         VALUES ($1, NULL, $2, 'ai', 'active', $3) RETURNING id`,
        [userId, generated.content.title, generated.content.durationWeeks ?? null],
      );
      await insertPlanContent(client, plan[0].id, generated.content.days);

      // Metas de nutrição: não substituem o plano alimentar de um nutricionista nem o que o próprio usuário já definiu.
      const { rows: other } = await client.query(
        `SELECT 1 FROM diet_plans WHERE patient_id = $1 AND status = 'active' AND source NOT IN ('ai') LIMIT 1`,
        [userId],
      );
      const nutritionApplied = other.length === 0;
      if (nutritionApplied) {
        await client.query(`UPDATE diet_plans SET status = 'archived' WHERE patient_id = $1 AND source = 'ai' AND status = 'active'`, [userId]);
        await client.query(
          `INSERT INTO diet_plans (patient_id, prescribed_by, title, source, status, target_kcal, target_protein_g, target_carb_g, target_fat_g)
           VALUES ($1, NULL, 'Metas do onboarding', 'ai', 'active', $2, $3, $4, $5)`,
          [userId, nutrition.kcal, nutrition.proteinG, nutrition.carbG, nutrition.fatG],
        );
      }
      await client.query(
        `UPDATE profiles SET onboarding_completed_at = now(), onboarding_step = 7 WHERE user_id = $1`,
        [userId],
      );
      await client.query('COMMIT');

      return {
        planId: plan[0].id,
        title: generated.content.title,
        summary: generated.summary,
        days: generated.content.days.length,
        nutrition,
        nutritionApplied,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    // Falha não deve prender o usuário num minuto de espera.
    lastStart.delete(userId);
    throw err;
  }
}
