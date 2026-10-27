import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { insertMeals } from '../nutrition/nutrition.service';
import type { UpdateProfileInput } from '../profile/profile.schemas';
import { updateProfile } from '../profile/profile.service';
import { loadPreferences } from '../preferences/preferences.service';
import { consumeQuota } from '../quotas/quotas.service';
import { insertPlanContent } from '../workout/workout.service';
import { loadFoodContext } from './food-context';
import { computeNutritionTargets } from './nutrition-targets';
import { completeAnswersSchema } from './onboarding.schemas';
import { createLogger } from './onboarding.log';
import { generatePlans } from './plan-generator';

const ageOf = (birthDate: string) => {
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
};

/**
 * Fecha o onboarding: grava o payload recebido (se vier), lê o perfil, calcula a meta calórica/macros,
 * pede treino + plano alimentar à Claude API, grava tudo numa transação e marca o onboarding como concluído.
 */
export async function completeOnboarding(userId: string, body?: UpdateProfileInput) {
  const log = createLogger(userId);
  log.info('POST /onboarding/complete recebido', { comPayload: !!body });
  log.debug('payload recebido do app', body ?? '(sem corpo: usando o que já está salvo no perfil)');

  if (body && Object.keys(body).length > 0) {
    await updateProfile(userId, body);
    log.info('payload gravado no perfil');
  }

  const { rows } = await pool.query(
    `SELECT u.name, to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date, p.sex, p.height_cm, p.weight_kg,
            p.fitness_level, p.goal, p.restrictions, p.onboarding, p.onboarding_step
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw new AppError(404, 'not_found', 'Usuário não encontrado');
  log.debug('perfil lido do banco antes de chamar a IA', r);

  // Biometria é indispensável (a meta calórica depende dela) e não tem valor padrão.
  const missing: string[] = [];
  if (!r.birth_date) missing.push('birthDate');
  if (!r.sex) missing.push('sex');
  if (r.height_cm === null || r.height_cm === undefined) missing.push('heightCm');
  if (r.weight_kg === null || r.weight_kg === undefined) missing.push('weightKg');
  if (missing.length > 0) {
    log.error('perfil sem dados obrigatórios', { missing });
    throw new AppError(400, 'onboarding_incomplete', `Faltam dados do perfil: ${missing.join(', ')}`, { missing });
  }

  // Demais campos: padrão + sinalização.
  const stored = (r.onboarding ?? {}) as Record<string, unknown>;
  const answers = completeAnswersSchema.safeParse(stored);
  if (!answers.success) {
    const issues = answers.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    log.error('respostas salvas do questionário inválidas', { issues, stored });
    throw new AppError(422, 'onboarding_invalid', 'Respostas do questionário inválidas', { issues });
  }
  const defaultsUsed = Object.keys(completeAnswersSchema.shape).filter((k) => stored[k] === undefined);
  const level = (r.fitness_level as 'beginner' | 'intermediate' | 'advanced' | null) ?? 'beginner';
  if (!r.fitness_level) defaultsUsed.push('fitnessLevel');
  if (answers.data.goalKey === 'race' && !answers.data.raceType) {
    answers.data.raceType = 'running';
    defaultsUsed.push('raceType');
  }
  if (defaultsUsed.length > 0) log.warn('dados ausentes; valores padrão usados', defaultsUsed);

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
    log.info('meta nutricional calculada', nutrition);

    const foods = await loadFoodContext(userId, answers.data.favoriteFoods, log);
    log.info('contexto de alimentos', {
      favoritos: foods.favorites.map((f) => `${f.typed} -> ${f.food?.name ?? 'NÃO ENCONTRADO'}`),
      maisConsumidos: foods.topConsumed.length,
      base: foods.staples.length,
    });

    const preferences = await loadPreferences(userId);
    log.info('preferências alimentares', { gosta: preferences.like.length, naoGosta: preferences.dislike.length });

    const generated = await generatePlans(
      { age, sex: r.sex, weightKg, heightCm, level, answers: answers.data, nutrition, foods, preferences, defaultsUsed },
      log,
    );

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

      // Metas e plano alimentar: não substituem o plano de um nutricionista nem o que o próprio usuário já definiu.
      const { rows: other } = await client.query(
        `SELECT 1 FROM diet_plans WHERE patient_id = $1 AND status = 'active' AND source <> 'ai' LIMIT 1`,
        [userId],
      );
      const nutritionApplied = other.length === 0;
      let dietPlanId: string | null = null;
      if (nutritionApplied) {
        await client.query(`UPDATE diet_plans SET status = 'archived' WHERE patient_id = $1 AND source = 'ai' AND status = 'active'`, [userId]);
        const { rows: diet } = await client.query<{ id: string }>(
          `INSERT INTO diet_plans (patient_id, prescribed_by, title, source, status, target_kcal, target_protein_g, target_carb_g, target_fat_g)
           VALUES ($1, NULL, 'Plano alimentar (IA)', 'ai', 'active', $2, $3, $4, $5) RETURNING id`,
          [userId, nutrition.kcal, nutrition.proteinG, nutrition.carbG, nutrition.fatG],
        );
        dietPlanId = diet[0].id;
        await insertMeals(
          client,
          dietPlanId,
          generated.mealPlan.meals.map((m) => ({
            name: m.name,
            timeSuggestion: m.timeSuggestion,
            foods: m.items.map((i) => ({ foodId: i.foodId, quantityG: i.quantityG })),
          })),
        );
      } else {
        log.warn('já existe plano alimentar ativo de outra origem; metas e plano alimentar da IA não foram gravados');
      }
      await client.query(`UPDATE profiles SET onboarding_completed_at = now(), onboarding_step = 8 WHERE user_id = $1`, [userId]);
      // Consome a cota na mesma transação do plano: só conta se a geração deu certo e foi gravada.
      await consumeQuota(userId, 'ai_workout_plan', plan[0].id, client);
      await client.query('COMMIT');
      log.info('onboarding concluído', { workoutPlanId: plan[0].id, dietPlanId, nutritionApplied });

      return {
        planId: plan[0].id,
        title: generated.content.title,
        summary: generated.summary,
        days: generated.content.days.length,
        nutrition,
        nutritionApplied,
        mealPlan: generated.mealPlan,
        defaultsUsed,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof AppError) log.error(`falha: ${err.status} ${err.code}`, err.details ?? err.message);
    else log.error('falha inesperada', { message: (err as Error).message, stack: (err as Error).stack });
    throw err;
  }
}
