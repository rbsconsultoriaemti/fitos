import { z } from 'zod';
import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { displayFoodName } from '../../shared/food-name';
import { updatePlanSchema, type PlanContent } from '../workout/workout.schemas';
import { callClaudeTool } from './claude';
import type { FoodContext } from './food-context';
import type { NutritionTargets } from './nutrition-targets';
import { GOAL_LABELS, type OnboardingAnswers } from './onboarding.schemas';
import { truncate, type OnboardingLogger } from './onboarding.log';

interface CatalogExercise {
  id: string;
  name: string;
  muscle_group: string;
  category: string;
  equipment: string | null;
}

export interface PersonForPlan {
  age: number;
  sex: 'male' | 'female' | 'other';
  weightKg: number;
  heightCm: number;
  level: 'beginner' | 'intermediate' | 'advanced';
  answers: OnboardingAnswers;
  nutrition: NutritionTargets;
  foods: FoodContext;
  /** Campos que não vieram do app/banco e receberam valor padrão. */
  defaultsUsed: string[];
}

export interface MealPlanItem {
  foodId: string;
  name: string;
  quantityG: number;
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface GeneratedMealPlan {
  meals: { name: string; timeSuggestion?: string; items: MealPlanItem[] }[];
  totals: { kcal: number; proteinG: number; carbG: number; fatG: number };
}

export interface GeneratedPlan {
  content: PlanContent;
  summary: string;
  mealPlan: GeneratedMealPlan;
}

const LEVEL_PT = {
  beginner: 'iniciante (menos de 6 meses)',
  intermediate: 'intermediário (6 meses a 2 anos)',
  advanced: 'avançado (mais de 2 anos)',
};
const LOCATION_PT = { gym: 'academia', home: 'em casa', outdoor: 'ao ar livre', mixed: 'misto (academia, casa e ar livre)' };
const MODALITY_PT = { strength: 'musculação', running: 'corrida de rua', cycling: 'ciclismo', functional: 'funcional', other: 'outro' };
const DIET_PT = {
  none: 'sem restrições',
  vegetarian: 'vegetariano',
  vegan: 'vegano',
  gluten_free: 'sem glúten',
  lactose_free: 'sem lactose',
  intolerance: 'intolerância',
};
const WATER_PT = { lt1: 'menos de 1 L por dia', '1to2': '1 a 2 L por dia', gt2: 'mais de 2 L por dia' };

const SYSTEM = `Você é um assistente de prescrição de treino e de organização alimentar do app FitOS. Monte (1) um plano de treino SEMANAL, que se repete, e (2) um plano alimentar de UM dia típico, chamando a ferramenta criar_plano.

TREINO — use EXCLUSIVAMENTE exercícios do catálogo, referenciados pelo número ("ref"):
- Use exatamente o número de dias de treino pedido, em dias da semana bem distribuídos (1 = segunda ... 7 = domingo), com descanso entre dias do mesmo grupo muscular.
- Ajuste a quantidade de exercícios à duração da sessão (musculação: ~6 a 8 min por exercício incluindo descanso; considere o aquecimento).
- Respeite o local de treino: em casa ou ao ar livre prefira peso corporal, halteres, funcionais e cardio; academia permite máquinas e barras; misto combina.
- Contemple as modalidades escolhidas. Corrida e ciclismo entram como dias de cardio (durationMin e, se couber, distanceKm), usando os exercícios de cardio do catálogo; se a modalidade for "outro", use o bom senso.
- Nível: iniciante = full body ou divisão simples, 2 a 3 séries, repetições 10-15; intermediário = divisões ABC/ABCD, 3 a 4 séries; avançado = maior volume e divisão por grupos, 3 a 5 séries. Não invente cargas.
- Objetivo: perder gordura = mais cardio e circuitos, descansos curtos; ganhar massa = foco em compostos, 8-12 repetições, descanso de 60 a 120 s; condicionamento = mistura de força e cardio; manter = equilíbrio; prova = priorize a modalidade da prova com sessões progressivas e a musculação como apoio.
- Se houver lesão ou limitação informada, evite exercícios que sobrecarreguem a região e diga isso nas "notes" do dia e no "summary". Não faça diagnóstico.
- Cada item de "sets" é UM exercício; para força informe "reps" (ex.: "10" ou "8-12"); para cardio informe durationMin e/ou distanceKm, nunca reps.

ALIMENTAÇÃO — use EXCLUSIVAMENTE alimentos do catálogo de alimentos, referenciados por "foodRef", com quantidade em gramas (peso do alimento como está no catálogo, ex.: arroz já cozido):
- Monte o número de refeições pedido (nome e horário HH:MM). A soma do dia deve ficar próxima da meta de kcal e dos macros informados (já calculados; não recalcule).
- Priorize os alimentos favoritos e os mais consumidos da pessoa, sem repetir o mesmo alimento na mesma refeição, e complete com o catálogo.
- Respeite as restrições alimentares (vegetariano/vegano: sem carnes/ovos/laticínios conforme o caso; sem glúten; sem lactose; intolerância informada). Se o catálogo não tiver substituto, use menos itens em vez de violar a restrição.

Escreva em português do Brasil. O "summary" tem até 5 frases curtas: lógica do treino, comentário sobre a meta calórica e os macros, e o lembrete de que é uma sugestão da IA que não substitui nutricionista, médico ou profissional de educação física.`;

const f1 = (n: number) => Math.round(n * 10) / 10;

function buildUserPrompt(p: PersonForPlan, catalog: CatalogExercise[], foodList: { id: string; line: string }[]) {
  const a = p.answers;
  const n = p.nutrition;
  const race = a.goalKey === 'race' && a.raceType ? ` (${a.raceType === 'running' ? 'corrida' : 'ciclismo'})` : '';
  const exerciseLines = catalog.map(
    (e, i) => `${i + 1} | ${e.name} | ${e.muscle_group} | ${e.category}${e.equipment ? ` | ${e.equipment}` : ''}`,
  );
  const diets = a.dietRestrictions.length ? a.dietRestrictions.map((d) => DIET_PT[d]).join(', ') : 'não informado';
  const foodLine = (f: { name: string; kcal: number; protein: number; carb: number; fat: number }) =>
    `${f.name}: ${f1(f.kcal)} kcal, P ${f1(f.protein)} g, C ${f1(f.carb)} g, G ${f1(f.fat)} g`;

  const favorites = p.foods.favorites.map((f) => (f.food ? `- ${f.typed} → ${foodLine(f.food)}` : `- ${f.typed} → (não encontrado na base TACO)`));
  const top = p.foods.topConsumed.map((f) => `- ${foodLine(f)} (registrado ${f.count}×)`);

  return `PERFIL
- Sexo: ${p.sex === 'male' ? 'masculino' : p.sex === 'female' ? 'feminino' : 'outro'}; idade: ${p.age} anos; peso: ${p.weightKg} kg; altura: ${p.heightCm} cm; IMC: ${n.bmi} (${n.bmiCategory})
- Objetivo: ${GOAL_LABELS[a.goalKey]}${race}
- Nível: ${LEVEL_PT[p.level]}
- Treina ${a.daysPerWeek} dias por semana, ${a.sessionMinutes} minutos por sessão, ${LOCATION_PT[a.location]}
- Modalidades: ${a.modalities.map((m) => MODALITY_PT[m]).join(', ')}
- Restrições alimentares: ${diets}${a.intoleranceText ? ` (intolerância: ${a.intoleranceText})` : ''}
- Refeições por dia: ${a.mealsPerDay}; água: ${WATER_PT[a.water]}
- Lesões/limitações: ${a.injuries || 'nenhuma informada'}
- Acompanhamento profissional: ${a.followUp.filter((f) => f !== 'none').join(', ') || 'nenhum'}
${p.defaultsUsed.length ? `- ATENÇÃO: não informados, valores padrão assumidos: ${p.defaultsUsed.join(', ')}\n` : ''}
META NUTRICIONAL JÁ CALCULADA (não recalcule)
- Gasto basal ${n.bmr} kcal; fator de atividade ${n.activityFactor}; gasto total ${n.tdee} kcal; ajuste do objetivo ${n.adjustmentPct}%
- Meta: ${n.kcal} kcal/dia; proteína ${n.proteinG} g; carboidrato ${n.carbG} g; gordura ${n.fatG} g
${n.notes.length ? `- Observações: ${n.notes.join(' ')}\n` : ''}
ALIMENTOS FAVORITOS (valores TACO por 100 g)
${favorites.join('\n') || '- nenhum informado'}

ALIMENTOS MAIS CONSUMIDOS (histórico, por 100 g)
${top.join('\n') || '- sem histórico ainda'}

CATÁLOGO DE ALIMENTOS (foodRef | alimento | kcal | proteína | carboidrato | gordura, por 100 g)
${foodList.map((f, i) => `${i + 1} | ${f.line}`).join('\n')}

CATÁLOGO DE EXERCÍCIOS (ref | exercício | grupo muscular | categoria | equipamento)
${exerciseLines.join('\n')}

Monte os dois planos chamando a ferramenta criar_plano.`;
}

const TOOL = {
  name: 'criar_plano',
  description: 'Registra o plano de treino semanal, o plano alimentar do dia e o resumo explicativo.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título curto do plano de treino' },
      durationWeeks: { type: 'integer', description: 'Duração sugerida em semanas (4 a 12)' },
      summary: { type: 'string', description: 'Resumo em português, até 5 frases' },
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dayOfWeek: { type: 'integer', description: '1 = segunda ... 7 = domingo' },
            muscleGroup: { type: 'string', description: 'Nome do treino do dia, ex.: "Peito e tríceps" ou "Corrida"' },
            notes: { type: 'string', description: 'Observação do dia (opcional)' },
            sets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ref: { type: 'integer', description: 'Número do exercício no catálogo' },
                  sets: { type: 'integer' },
                  reps: { type: 'string', description: 'Ex.: "10" ou "8-12". Só para força.' },
                  restSeconds: { type: 'integer' },
                  durationMin: { type: 'integer', description: 'Cardio: minutos' },
                  distanceKm: { type: 'number', description: 'Cardio: km (opcional)' },
                },
                required: ['ref', 'sets'],
              },
            },
          },
          required: ['dayOfWeek', 'muscleGroup', 'sets'],
        },
      },
      meals: {
        type: 'array',
        description: 'Plano alimentar de um dia típico',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Ex.: "Café da manhã"' },
            timeSuggestion: { type: 'string', description: 'HH:MM' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  foodRef: { type: 'integer', description: 'Número do alimento no catálogo de alimentos' },
                  quantityG: { type: 'number', description: 'Quantidade em gramas' },
                },
                required: ['foodRef', 'quantityG'],
              },
            },
          },
          required: ['name', 'items'],
        },
      },
    },
    required: ['title', 'summary', 'days', 'meals'],
  },
};

// ---------- validação campo a campo da resposta da IA ----------

const opt = <T extends z.ZodType>(s: T) => s.nullish();
const rawSet = z.object({
  ref: z.number().int(),
  sets: opt(z.number()),
  reps: opt(z.union([z.string(), z.number()])),
  restSeconds: opt(z.number()),
  durationMin: opt(z.number()),
  distanceKm: opt(z.number()),
});
const rawDay = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  muscleGroup: z.string().min(1),
  notes: opt(z.string()),
  sets: z.array(rawSet).min(1),
});
const rawMeal = z.object({
  name: z.string().min(1),
  timeSuggestion: opt(z.string()),
  items: z.array(z.object({ foodRef: z.number().int(), quantityG: z.number().positive() })).min(1),
});
const rawPlan = z.object({
  title: z.string().min(1),
  durationWeeks: opt(z.number()),
  summary: z.string().min(1),
  days: z.array(rawDay).min(1),
  meals: z.array(rawMeal).min(1),
});

export interface PlanIssue {
  path: string;
  message: string;
}

const int = (v: unknown, min: number, max: number) => {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const round5 = (g: number) => Math.min(1500, Math.max(5, Math.round(g / 5) * 5));

type DaySets = PlanContent['days'][number]['sets'];
type RawPlan = z.infer<typeof rawPlan>;

/** Converte a resposta já validada em conteúdo gravável, descartando referências inexistentes (registradas em `warnings`). */
function build(
  raw: RawPlan,
  catalog: CatalogExercise[],
  foodList: { id: string; food: { name: string; kcal: number; protein: number; carb: number; fat: number } }[],
  p: PersonForPlan,
  warnings: string[],
): GeneratedPlan | PlanIssue[] {
  const issues: PlanIssue[] = [];

  // --- treino ---
  const seen = new Set<number>();
  const days: PlanContent['days'] = [];
  raw.days.forEach((d, di) => {
    if (seen.has(d.dayOfWeek)) {
      warnings.push(`days[${di}]: dayOfWeek ${d.dayOfWeek} repetido, descartado`);
      return;
    }
    const sets: DaySets = [];
    d.sets.slice(0, 14).forEach((s, si) => {
      const ex = catalog[s.ref - 1];
      if (!ex) {
        warnings.push(`days[${di}].sets[${si}]: ref ${s.ref} não existe no catálogo de exercícios, descartado`);
        return;
      }
      const out: DaySets[number] = { exerciseId: ex.id, sets: int(s.sets, 1, 10) ?? 3 };
      const rest = int(s.restSeconds, 0, 600);
      if (rest !== undefined) out.restSeconds = rest;
      if (ex.category === 'cardio') {
        out.sets = 1;
        out.durationMin = int(s.durationMin, 1, 300) ?? 30;
        if (typeof s.distanceKm === 'number' && s.distanceKm > 0 && s.distanceKm < 500) out.distanceKm = Math.round(s.distanceKm * 10) / 10;
      } else {
        const reps = typeof s.reps === 'string' ? /\d+(-\d+)?/.exec(s.reps)?.[0] : typeof s.reps === 'number' ? String(Math.round(s.reps)) : undefined;
        if (!reps) warnings.push(`days[${di}].sets[${si}]: sem reps válidas, usado 10-12`);
        out.reps = reps ?? '10-12';
      }
      sets.push(out);
    });
    if (sets.length === 0) {
      issues.push({ path: `days[${di}].sets`, message: 'nenhum exercício válido no dia' });
      return;
    }
    seen.add(d.dayOfWeek);
    days.push({
      dayOfWeek: d.dayOfWeek,
      muscleGroup: d.muscleGroup.trim().slice(0, 60).length >= 2 ? d.muscleGroup.trim().slice(0, 60) : 'Treino',
      notes: d.notes?.trim() ? d.notes.trim().slice(0, 1000) : undefined,
      sets,
    });
  });
  days.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  if (days.length > p.answers.daysPerWeek) warnings.push(`IA devolveu ${days.length} dias; mantidos os ${p.answers.daysPerWeek} primeiros`);
  if (days.length < p.answers.daysPerWeek) warnings.push(`IA devolveu só ${days.length} dias de treino (pedidos ${p.answers.daysPerWeek})`);

  const content = updatePlanSchema.safeParse({
    title: raw.title.trim().slice(0, 120),
    durationWeeks: int(raw.durationWeeks, 1, 52),
    days: days.slice(0, p.answers.daysPerWeek),
  });
  if (!content.success) {
    issues.push(...content.error.issues.map((i) => ({ path: i.path.join('.') || 'plano', message: i.message })));
  }

  // --- plano alimentar ---
  const meals: GeneratedMealPlan['meals'] = [];
  raw.meals.slice(0, 8).forEach((m, mi) => {
    const used = new Set<number>();
    const items: { food: (typeof foodList)[number]; g: number }[] = [];
    m.items.forEach((it, ii) => {
      const food = foodList[it.foodRef - 1];
      if (!food) return void warnings.push(`meals[${mi}].items[${ii}]: foodRef ${it.foodRef} não existe no catálogo de alimentos, descartado`);
      if (used.has(it.foodRef)) return void warnings.push(`meals[${mi}].items[${ii}]: alimento repetido na refeição, descartado`);
      used.add(it.foodRef);
      items.push({ food, g: it.quantityG });
    });
    if (items.length === 0) {
      issues.push({ path: `meals[${mi}].items`, message: 'nenhum alimento válido na refeição' });
      return;
    }
    const time = m.timeSuggestion && /^([01]\d|2[0-3]):[0-5]\d$/.test(m.timeSuggestion) ? m.timeSuggestion : undefined;
    if (m.timeSuggestion && !time) warnings.push(`meals[${mi}]: horário "${m.timeSuggestion}" fora do formato HH:MM, ignorado`);
    meals.push({
      name: m.name.trim().slice(0, 120),
      timeSuggestion: time,
      items: items.map(({ food, g }) => ({ foodId: food.id, name: displayFoodName(food.food.name, 'taco'), quantityG: g, kcal: 0, proteinG: 0, carbG: 0, fatG: 0 })),
    });
  });

  if (issues.length > 0 || !content.success) return issues;

  // Ajusta as quantidades para a soma do dia bater com a meta calórica (a IA erra na conta; o servidor não).
  const per100 = new Map(foodList.map((f) => [f.id, f.food]));
  const total = meals.reduce((s, m) => s + m.items.reduce((t, i) => t + (i.quantityG / 100) * per100.get(i.foodId)!.kcal, 0), 0);
  const factor = total > 0 ? Math.min(2, Math.max(0.5, p.nutrition.kcal / total)) : 1;
  if (factor < 0.8 || factor > 1.25) warnings.push(`plano alimentar da IA somava ${Math.round(total)} kcal (meta ${p.nutrition.kcal}); quantidades ajustadas ×${f1(factor)}`);
  const totals = { kcal: 0, proteinG: 0, carbG: 0, fatG: 0 };
  for (const m of meals) {
    for (const i of m.items) {
      const f = per100.get(i.foodId)!;
      i.quantityG = round5(i.quantityG * factor);
      const k = i.quantityG / 100;
      i.kcal = f1(f.kcal * k);
      i.proteinG = f1(f.protein * k);
      i.carbG = f1(f.carb * k);
      i.fatG = f1(f.fat * k);
      totals.kcal += i.kcal;
      totals.proteinG += i.proteinG;
      totals.carbG += i.carbG;
      totals.fatG += i.fatG;
    }
  }

  return {
    content: content.data,
    summary: raw.summary.trim().slice(0, 1500),
    mealPlan: { meals, totals: { kcal: Math.round(totals.kcal), proteinG: Math.round(totals.proteinG), carbG: Math.round(totals.carbG), fatG: Math.round(totals.fatG) } },
  };
}

/**
 * Gera treino + plano alimentar com a Claude API. Valida a resposta campo a campo; se vier inutilizável
 * depois de 2 tentativas, responde 422 com a lista de problemas.
 */
export async function generatePlans(p: PersonForPlan, log: OnboardingLogger): Promise<GeneratedPlan> {
  const { rows: catalog } = await pool.query<CatalogExercise>(
    'SELECT id, name, muscle_group, category, equipment FROM exercises ORDER BY muscle_group, name',
  );
  if (catalog.length === 0) throw new AppError(500, 'no_exercises', 'Catálogo de exercícios vazio');

  // Catálogo de alimentos: favoritos, mais consumidos e base, sem repetir.
  const seen = new Set<string>();
  const foodList: { id: string; food: { name: string; kcal: number; protein: number; carb: number; fat: number }; line: string }[] = [];
  const push = (f: { id: string; name: string; kcal: number; protein: number; carb: number; fat: number }, tag: string) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    foodList.push({
      id: f.id,
      food: f,
      line: `${f.name}${tag} | ${f1(f.kcal)} | ${f1(f.protein)} | ${f1(f.carb)} | ${f1(f.fat)}`,
    });
  };
  p.foods.favorites.forEach((f) => f.food && push(f.food, ' ★favorito'));
  p.foods.topConsumed.forEach((f) => push(f, ' ★mais consumido'));
  p.foods.staples.forEach((f) => push(f, ''));

  const user = buildUserPrompt(p, catalog, foodList);
  log.debug('prompt completo enviado à Claude API', `\n--- SYSTEM ---\n${SYSTEM}\n--- USER ---\n${user}`);
  log.info('prompt montado', { chars: user.length, exercicios: catalog.length, alimentos: foodList.length });

  let lastIssues: PlanIssue[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await callClaudeTool({ system: SYSTEM, user, tool: TOOL }, log);

    if (res.stopReason === 'max_tokens') {
      lastIssues = [{ path: '(resposta)', message: 'resposta cortada por limite de tokens (max_tokens)' }];
      log.error(`tentativa ${attempt}: resposta truncada`, { stopReason: res.stopReason });
      continue;
    }

    const parsed = rawPlan.safeParse(res.input);
    if (!parsed.success) {
      lastIssues = parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(raiz)', message: i.message }));
      log.error(`tentativa ${attempt}: resposta fora do formato esperado`, { issues: lastIssues, input: truncate(JSON.stringify(res.input), 2500) });
      continue;
    }

    const warnings: string[] = [];
    const built = build(parsed.data, catalog, foodList, p, warnings);
    if (warnings.length) log.warn(`tentativa ${attempt}: ajustes na resposta da IA`, warnings);
    if (Array.isArray(built)) {
      lastIssues = built;
      log.error(`tentativa ${attempt}: resposta sem conteúdo utilizável`, { issues: built });
      continue;
    }
    log.info('resposta da IA validada', {
      dias: built.content.days.length,
      refeicoes: built.mealPlan.meals.length,
      totaisPlanoAlimentar: built.mealPlan.totals,
    });
    return built;
  }
  throw new AppError(422, 'ai_invalid_response', 'A IA devolveu um plano em formato inválido. Tente novamente.', { issues: lastIssues });
}
