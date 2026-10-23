import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { loadFoodContext } from '../onboarding/food-context';
import { computeNutritionTargets } from '../onboarding/nutrition-targets';
import { createLogger } from '../onboarding/onboarding.log';
import { completeAnswersSchema } from '../onboarding/onboarding.schemas';
import { generatePlans } from '../onboarding/plan-generator';

// Cada sugestão custa uma chamada à Claude API: no máximo uma por professor a cada 30 s.
const COOLDOWN_MS = 30_000;
const lastStart = new Map<string, number>();

const ageOf = (birthDate: string) => {
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
};

/**
 * Rascunho de treino para o aluno, gerado pela IA a partir do perfil dele. NÃO grava nada: o professor revisa,
 * edita e só então envia (POST /workout/plans + approve). O gerador também monta um plano alimentar, que é descartado
 * aqui (prescrição de dieta é do nutricionista).
 */
export async function suggestPlan(trainerId: string, studentId: string) {
  const { rows: link } = await pool.query(
    `SELECT 1 FROM trainer_student WHERE trainer_id = $1 AND student_id = $2 AND status = 'active'`,
    [trainerId, studentId],
  );
  if (link.length === 0) throw new AppError(404, 'not_found', 'Aluno não encontrado');

  const { rows } = await pool.query(
    `SELECT to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date, p.sex, p.height_cm, p.weight_kg, p.fitness_level, p.onboarding
     FROM profiles p WHERE p.user_id = $1`,
    [studentId],
  );
  const r = rows[0];
  const missing: string[] = [];
  if (!r?.birth_date) missing.push('data de nascimento');
  if (!r?.sex) missing.push('sexo');
  if (!r?.height_cm) missing.push('altura');
  if (!r?.weight_kg) missing.push('peso');
  if (missing.length > 0) {
    throw new AppError(400, 'student_profile_incomplete', `O perfil do aluno está incompleto (faltam: ${missing.join(', ')}). Peça para ele completar o perfil ou crie o treino manualmente.`, { missing });
  }

  const parsed = completeAnswersSchema.safeParse(r.onboarding ?? {});
  if (!parsed.success) throw new AppError(422, 'onboarding_invalid', 'Respostas do questionário do aluno inválidas');
  const answers = parsed.data;
  if (answers.goalKey === 'race' && !answers.raceType) answers.raceType = 'running';
  const level = (r.fitness_level as 'beginner' | 'intermediate' | 'advanced' | null) ?? 'beginner';

  const now = Date.now();
  if (now - (lastStart.get(trainerId) ?? 0) < COOLDOWN_MS) {
    throw new AppError(429, 'too_many_requests', 'Aguarde alguns segundos antes de pedir outra sugestão');
  }
  lastStart.set(trainerId, now);

  const log = createLogger(studentId);
  try {
    const age = ageOf(r.birth_date);
    const weightKg = Number(r.weight_kg);
    const heightCm = Number(r.height_cm);
    const nutrition = computeNutritionTargets({
      weightKg,
      heightCm,
      age,
      sex: r.sex,
      goal: answers.goalKey,
      daysPerWeek: answers.daysPerWeek,
      sessionMinutes: answers.sessionMinutes,
    });
    const foods = await loadFoodContext(studentId, answers.favoriteFoods, log);
    const generated = await generatePlans({ age, sex: r.sex, weightKg, heightCm, level, answers, nutrition, foods, defaultsUsed: [] }, log);

    // O app precisa dos nomes para exibir/editar os exercícios.
    const ids = [...new Set(generated.content.days.flatMap((d) => d.sets.map((s) => s.exerciseId)))];
    const { rows: ex } = await pool.query<{ id: string; name: string }>('SELECT id, name FROM exercises WHERE id = ANY($1::uuid[])', [ids]);
    const names = new Map(ex.map((e) => [e.id, e.name]));

    return {
      title: generated.content.title,
      durationWeeks: generated.content.durationWeeks ?? null,
      summary: generated.summary,
      days: generated.content.days.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        muscleGroup: d.muscleGroup,
        notes: d.notes ?? null,
        sets: d.sets.map((s) => ({ ...s, exerciseName: names.get(s.exerciseId) ?? '' })),
      })),
    };
  } catch (err) {
    lastStart.delete(trainerId);
    throw err;
  }
}
