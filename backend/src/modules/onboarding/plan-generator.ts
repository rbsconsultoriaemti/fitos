import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { updatePlanSchema, type PlanContent } from '../workout/workout.schemas';
import { callClaudeTool } from './claude';
import type { NutritionTargets } from './nutrition-targets';
import { GOAL_LABELS, type OnboardingAnswers } from './onboarding.schemas';

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
}

export interface GeneratedPlan {
  content: PlanContent;
  summary: string;
}

const LEVEL_PT = {
  beginner: 'iniciante (menos de 6 meses)',
  intermediate: 'intermediário (6 meses a 2 anos)',
  advanced: 'avançado (mais de 2 anos)',
};
const LOCATION_PT = { gym: 'academia', home: 'em casa', outdoor: 'ao ar livre', mixed: 'misto (academia, casa e ar livre)' };
const MODALITY_PT = { strength: 'musculação', running: 'corrida de rua', cycling: 'ciclismo', functional: 'funcional', other: 'outro' };

const SYSTEM = `Você é um assistente de prescrição de treino do app FitOS. Monte um plano SEMANAL (que se repete) usando EXCLUSIVAMENTE exercícios do catálogo fornecido, referenciados pelo número ("ref").
Regras:
- Use exatamente o número de dias de treino pedido, em dias da semana bem distribuídos (1 = segunda ... 7 = domingo), com descanso entre dias do mesmo grupo muscular.
- Ajuste a quantidade de exercícios à duração da sessão (musculação: ~6 a 8 min por exercício incluindo descanso; considere o aquecimento no total).
- Respeite o local de treino: em casa ou ao ar livre prefira peso corporal, halteres, funcionais e cardio; academia permite máquinas e barras; misto combina.
- Contemple as modalidades escolhidas. Corrida e ciclismo entram como dias de cardio (durationMin e, se couber, distanceKm), usando os exercícios de cardio do catálogo; se a modalidade for "outro", use o bom senso.
- Nível: iniciante = full body ou divisão simples, 2 a 3 séries, repetições 10-15; intermediário = divisões ABC/ABCD, 3 a 4 séries; avançado = maior volume e divisão por grupos, 3 a 5 séries. Não invente cargas: omita loadKg.
- Objetivo: perder gordura = mais cardio e circuitos, descansos curtos; ganhar massa = foco em compostos, 8-12 repetições, descanso de 60 a 120 s; condicionamento = mistura de força e cardio; manter = equilíbrio; prova = priorize a modalidade da prova (corrida ou ciclismo) com sessões progressivas e a musculação como apoio.
- Se houver lesão ou limitação informada, evite exercícios que sobrecarreguem a região e diga isso nas "notes" do dia e no "summary". Não faça diagnóstico.
- Cada item de "sets" é UM exercício com número de séries; para força informe "reps" (ex.: "10" ou "8-12"); para cardio informe durationMin e/ou distanceKm, nunca reps.
- Escreva em português do Brasil. O "summary" tem até 5 frases curtas: explica a lógica do treino, comenta a meta calórica e os macros recebidos (sem recalculá-los) e lembra que é uma sugestão da IA que não substitui profissionais de saúde.`;

function buildUserPrompt(p: PersonForPlan, catalog: CatalogExercise[]) {
  const a = p.answers;
  const lines = catalog.map(
    (e, i) => `${i + 1} | ${e.name} | ${e.muscle_group} | ${e.category}${e.equipment ? ` | ${e.equipment}` : ''}`,
  );
  const race = a.goalKey === 'race' && a.raceType ? ` (${a.raceType === 'running' ? 'corrida' : 'ciclismo'})` : '';
  return `PERFIL
- Sexo: ${p.sex === 'male' ? 'masculino' : p.sex === 'female' ? 'feminino' : 'outro'}; idade: ${p.age}; peso: ${p.weightKg} kg; altura: ${p.heightCm} cm; IMC: ${p.nutrition.bmi} (${p.nutrition.bmiCategory})
- Objetivo: ${GOAL_LABELS[a.goalKey]}${race}
- Nível: ${LEVEL_PT[p.level]}
- Treina ${a.daysPerWeek} dias por semana, ${a.sessionMinutes} minutos por sessão, ${LOCATION_PT[a.location]}
- Modalidades: ${a.modalities.map((m) => MODALITY_PT[m]).join(', ')}
- Lesões/limitações: ${a.injuries || 'nenhuma informada'}
- Acompanhamento profissional: ${a.followUp.filter((f) => f !== 'none').join(', ') || 'nenhum'}

META NUTRICIONAL JÁ CALCULADA (não recalcule): ${p.nutrition.kcal} kcal/dia; proteína ${p.nutrition.proteinG} g; carboidrato ${p.nutrition.carbG} g; gordura ${p.nutrition.fatG} g.

CATÁLOGO (ref | exercício | grupo muscular | categoria | equipamento)
${lines.join('\n')}

Monte o plano chamando a ferramenta criar_plano.`;
}

const TOOL = {
  name: 'criar_plano',
  description: 'Registra o plano de treino semanal e o resumo explicativo.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título curto do plano' },
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
    },
    required: ['title', 'summary', 'days'],
  },
};

const int = (v: unknown, min: number, max: number) => {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

type DaySets = PlanContent['days'][number]['sets'];

/** Converte a saída crua da IA em conteúdo de plano válido, descartando o que não existe no catálogo. */
function sanitize(raw: any, catalog: CatalogExercise[], daysPerWeek: number): GeneratedPlan | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days)) return null;
  const seen = new Set<number>();
  const days: PlanContent['days'] = [];

  for (const d of raw.days) {
    const dayOfWeek = int(d?.dayOfWeek, 1, 7);
    if (!dayOfWeek || seen.has(dayOfWeek) || !Array.isArray(d.sets)) continue;
    const sets: DaySets = [];
    for (const s of d.sets.slice(0, 14)) {
      const ex = catalog[Number(s?.ref) - 1];
      if (!ex) continue;
      const out: DaySets[number] = { exerciseId: ex.id, sets: int(s.sets, 1, 10) ?? 3 };
      const rest = int(s.restSeconds, 0, 600);
      if (rest !== undefined) out.restSeconds = rest;
      if (ex.category === 'cardio') {
        out.sets = 1;
        out.durationMin = int(s.durationMin, 1, 300) ?? 30;
        if (typeof s.distanceKm === 'number' && s.distanceKm > 0 && s.distanceKm < 500) {
          out.distanceKm = Math.round(s.distanceKm * 10) / 10;
        }
      } else {
        const reps = typeof s.reps === 'string' ? /\d+(-\d+)?/.exec(s.reps)?.[0] : typeof s.reps === 'number' ? String(Math.round(s.reps)) : undefined;
        out.reps = reps ?? '10-12';
      }
      sets.push(out);
    }
    if (sets.length === 0) continue;
    seen.add(dayOfWeek);
    const muscleGroup = String(d.muscleGroup ?? '').trim().slice(0, 60);
    days.push({
      dayOfWeek,
      muscleGroup: muscleGroup.length >= 2 ? muscleGroup : 'Treino',
      notes: typeof d.notes === 'string' && d.notes.trim() ? d.notes.trim().slice(0, 1000) : undefined,
      sets,
    });
  }

  days.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  if (days.length === 0) return null;

  const content = updatePlanSchema.safeParse({
    title: String(raw.title ?? '').trim().slice(0, 120) || 'Plano FitOS',
    durationWeeks: int(raw.durationWeeks, 1, 52),
    days: days.slice(0, daysPerWeek),
  });
  if (!content.success) return null;
  return { content: content.data, summary: String(raw.summary ?? '').trim().slice(0, 1500) };
}

/** Gera o plano de treino com a Claude API a partir do questionário. Tenta duas vezes se a saída vier inutilizável. */
export async function generateWorkoutPlan(p: PersonForPlan): Promise<GeneratedPlan> {
  const { rows: catalog } = await pool.query<CatalogExercise>(
    'SELECT id, name, muscle_group, category, equipment FROM exercises ORDER BY muscle_group, name',
  );
  if (catalog.length === 0) throw new AppError(500, 'no_exercises', 'Catálogo de exercícios vazio');

  const user = buildUserPrompt(p, catalog);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await callClaudeTool({ system: SYSTEM, user, tool: TOOL });
    const plan = sanitize(raw, catalog, p.answers.daysPerWeek);
    if (plan) return plan;
    console.error(`[onboarding] saída da IA inválida (tentativa ${attempt})`);
  }
  throw new AppError(502, 'ai_invalid', 'A IA devolveu um plano inválido, tente novamente');
}
