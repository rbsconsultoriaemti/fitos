import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseDecimal } from '@/lib/format';
import type { Profile } from '@/lib/types';

// ---------- opções ----------

export type GoalKey = 'lose_fat' | 'gain_muscle' | 'conditioning' | 'maintain' | 'race';
export type RaceType = 'running' | 'cycling';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type Location = 'gym' | 'home' | 'outdoor' | 'mixed';
export type Modality = 'strength' | 'running' | 'cycling' | 'functional' | 'other';
export type DietRestriction = 'none' | 'vegetarian' | 'vegan' | 'gluten_free' | 'lactose_free' | 'intolerance';
export type Water = 'lt1' | '1to2' | 'gt2';
export type FollowUp = 'none' | 'personal' | 'nutritionist' | 'doctor' | 'psychologist';

export const GOALS: { key: GoalKey; label: string; description: string; icon: string }[] = [
  { key: 'lose_fat', label: 'Perder gordura', description: 'Reduzir o percentual de gordura com déficit calórico moderado', icon: 'flame-outline' },
  { key: 'gain_muscle', label: 'Ganhar massa muscular', description: 'Hipertrofia, com foco em treino de força e proteína', icon: 'barbell-outline' },
  { key: 'conditioning', label: 'Melhorar condicionamento', description: 'Mais fôlego, energia e resistência no dia a dia', icon: 'pulse-outline' },
  { key: 'maintain', label: 'Manter peso e saúde', description: 'Manter o corpo ativo e a rotina equilibrada', icon: 'shield-checkmark-outline' },
  { key: 'race', label: 'Preparação para prova', description: 'Treinar para uma prova de corrida ou de ciclismo', icon: 'trophy-outline' },
];

export const LEVELS: { key: Level; label: string; description: string }[] = [
  { key: 'beginner', label: 'Iniciante', description: 'Menos de 6 meses treinando' },
  { key: 'intermediate', label: 'Intermediário', description: '6 meses a 2 anos' },
  { key: 'advanced', label: 'Avançado', description: 'Mais de 2 anos' },
];

export const DAYS = [2, 3, 4, 5, 6] as const;
export const MINUTES: { value: 30 | 45 | 60 | 90; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1h' },
  { value: 90, label: '1h30' },
];
export const LOCATIONS: { key: Location; label: string }[] = [
  { key: 'gym', label: 'Academia' },
  { key: 'home', label: 'Em casa' },
  { key: 'outdoor', label: 'Ar livre' },
  { key: 'mixed', label: 'Misto' },
];
export const MODALITIES: { key: Modality; label: string }[] = [
  { key: 'strength', label: 'Musculação' },
  { key: 'running', label: 'Corrida de rua' },
  { key: 'cycling', label: 'Ciclismo' },
  { key: 'functional', label: 'Funcional' },
  { key: 'other', label: 'Outro' },
];
export const DIETS: { key: DietRestriction; label: string }[] = [
  { key: 'none', label: 'Sem restrições' },
  { key: 'vegetarian', label: 'Vegetariano' },
  { key: 'vegan', label: 'Vegano' },
  { key: 'gluten_free', label: 'Sem glúten' },
  { key: 'lactose_free', label: 'Sem lactose' },
  { key: 'intolerance', label: 'Intolerância a algum alimento' },
];
export const MEALS = [3, 4, 5, 6] as const; // 6 = "6 ou mais"
export const WATER: { key: Water; label: string }[] = [
  { key: 'lt1', label: 'Menos de 1 L' },
  { key: '1to2', label: '1 a 2 L' },
  { key: 'gt2', label: 'Mais de 2 L' },
];
export const FOLLOW_UPS: { key: FollowUp; label: string }[] = [
  { key: 'none', label: 'Não' },
  { key: 'personal', label: 'Personal trainer' },
  { key: 'nutritionist', label: 'Nutricionista' },
  { key: 'doctor', label: 'Médico' },
  { key: 'psychologist', label: 'Psicólogo' },
];

export const STEP_TITLES = [
  'Dados pessoais',
  'Objetivo principal',
  'Nível de experiência',
  'Rotina de treino',
  'Alimentação',
  'Preferências alimentares',
  'Saúde',
  'Resumo',
] as const;
export const LAST_STEP = STEP_TITLES.length;
export const OPTIONAL_STEPS: readonly number[] = [5, 6, 7];

// ---------- formulário ----------

export interface OnboardingForm {
  name: string;
  birthDate: string; // DD/MM/AAAA
  sex: 'male' | 'female' | null;
  heightCm: string;
  weightKg: string;
  goal: GoalKey | null;
  raceType: RaceType | null;
  level: Level | null;
  daysPerWeek: number | null;
  sessionMinutes: 30 | 45 | 60 | 90 | null;
  location: Location | null;
  modalities: Modality[];
  dietRestrictions: DietRestriction[];
  intoleranceText: string;
  mealsPerDay: number | null;
  water: Water | null;
  favoriteFoods: string; // separados por vírgula
  injuries: string;
  followUp: FollowUp[];
  /** Preferências alimentares (etapa 6): só gosto / não gosto; ausente = indiferente. Vão para PUT /preferences/foods. */
  foodPrefs: Record<string, 'like' | 'dislike'>;
}

export const emptyForm = (): OnboardingForm => ({
  name: '',
  birthDate: '',
  sex: null,
  heightCm: '',
  weightKg: '',
  goal: null,
  raceType: null,
  level: null,
  daysPerWeek: null,
  sessionMinutes: null,
  location: null,
  modalities: [],
  dietRestrictions: [],
  intoleranceText: '',
  mealsPerDay: null,
  water: null,
  favoriteFoods: '',
  injuries: '',
  followUp: [],
  foodPrefs: {},
});

const show = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

/** Máscara DD/MM/AAAA enquanto digita. */
export function maskDate(text: string) {
  const d = text.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export function birthToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const date = new Date(`${iso}T12:00:00Z`);
  const valid = !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) && date <= new Date() && Number(m[3]) >= 1900;
  return valid ? iso : null;
}

export function ageFromIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
}

/** Monta o formulário a partir do que o servidor já tem (perfil + respostas salvas). */
export function formFromProfile(p: Profile): OnboardingForm {
  const a = (p.onboarding?.answers ?? {}) as Partial<OnboardingForm> & { goalKey?: GoalKey };
  const [y, m, d] = p.birthDate ? p.birthDate.split('-') : ['', '', ''];
  return {
    ...emptyForm(),
    name: p.name,
    birthDate: p.birthDate ? `${d}/${m}/${y}` : '',
    sex: p.sex === 'male' || p.sex === 'female' ? p.sex : null,
    heightCm: show(p.heightCm),
    weightKg: show(p.weightKg),
    goal: a.goalKey ?? null,
    raceType: a.raceType ?? null,
    level: p.fitnessLevel,
    daysPerWeek: a.daysPerWeek ?? null,
    sessionMinutes: a.sessionMinutes ?? null,
    location: a.location ?? null,
    modalities: a.modalities ?? [],
    dietRestrictions: a.dietRestrictions ?? [],
    intoleranceText: a.intoleranceText ?? '',
    mealsPerDay: a.mealsPerDay ?? null,
    water: a.water ?? null,
    favoriteFoods: Array.isArray(a.favoriteFoods) ? (a.favoriteFoods as unknown as string[]).join(', ') : '',
    injuries: a.injuries ?? '',
    followUp: a.followUp ?? [],
  };
}

// ---------- validação por etapa ----------

/** Mensagem de erro da etapa, ou null se pode avançar. As etapas 5, 6 e 7 nunca bloqueiam. */
export function validateStep(step: number, f: OnboardingForm): string | null {
  switch (step) {
    case 1: {
      if (f.name.trim().length < 2) return 'Informe seu nome completo.';
      const iso = birthToIso(f.birthDate);
      if (!iso) return 'Data de nascimento inválida: use DD/MM/AAAA.';
      const age = ageFromIso(iso);
      if (age < 10 || age > 110) return 'Confira a data de nascimento.';
      if (!f.sex) return 'Escolha o sexo.';
      const h = parseDecimal(f.heightCm);
      if (h === null || h < 50 || h > 260) return 'Altura inválida: informe em centímetros (ex.: 178).';
      const w = parseDecimal(f.weightKg);
      if (w === null || w < 20 || w > 500) return 'Peso inválido: informe em quilos (ex.: 82,5).';
      return null;
    }
    case 2:
      if (!f.goal) return 'Escolha seu objetivo principal.';
      if (f.goal === 'race' && !f.raceType) return 'Escolha se a prova é de corrida ou de ciclismo.';
      return null;
    case 3:
      return f.level ? null : 'Escolha seu nível de experiência.';
    case 4:
      if (!f.daysPerWeek) return 'Escolha quantos dias por semana você treina.';
      if (!f.sessionMinutes) return 'Escolha o tempo por sessão.';
      if (!f.location) return 'Escolha onde você treina.';
      if (f.modalities.length === 0) return 'Escolha ao menos uma modalidade.';
      return null;
    default:
      return null;
  }
}

// ---------- o que cada etapa grava (PUT /profile) ----------

const GOAL_TEXT: Record<GoalKey, string> = {
  lose_fat: 'Perder gordura',
  gain_muscle: 'Ganhar massa muscular',
  conditioning: 'Melhorar condicionamento',
  maintain: 'Manter peso e saúde',
  race: 'Preparação para prova',
};

const DIET_TEXT: Record<Exclude<DietRestriction, 'none' | 'intolerance'>, string> = {
  vegetarian: 'Vegetariano',
  vegan: 'Vegano',
  gluten_free: 'Sem glúten',
  lactose_free: 'Sem lactose',
};

/** "arroz, feijão; frango" -> ['arroz', 'feijão', 'frango'] (até 15, sem repetir). */
export const parseFavorites = (text: string) => [...new Set(text.split(/[,;\n]+/).map((t) => t.trim().slice(0, 60)).filter(Boolean))].slice(0, 15);

export const goalText = (f: OnboardingForm) =>
  f.goal ? `${GOAL_TEXT[f.goal]}${f.goal === 'race' && f.raceType ? (f.raceType === 'running' ? ' (corrida)' : ' (ciclismo)') : ''}` : null;

/** Corpo do PUT /profile para a etapa. `step` enviado = etapa em que o usuário retoma. */
export function stepPayload(step: number, f: OnboardingForm): Record<string, unknown> {
  const resume = Math.min(step + 1, LAST_STEP);
  switch (step) {
    case 1:
      return {
        name: f.name.trim(),
        birthDate: birthToIso(f.birthDate),
        sex: f.sex,
        heightCm: parseDecimal(f.heightCm),
        weightKg: parseDecimal(f.weightKg),
        onboarding: { step: resume, answers: {} },
      };
    case 2:
      return { goal: goalText(f), onboarding: { step: resume, answers: { goalKey: f.goal, raceType: f.goal === 'race' ? f.raceType : null } } };
    case 3:
      return { fitnessLevel: f.level, onboarding: { step: resume, answers: {} } };
    case 4:
      return {
        onboarding: {
          step: resume,
          answers: { daysPerWeek: f.daysPerWeek, sessionMinutes: f.sessionMinutes, location: f.location, modalities: f.modalities },
        },
      };
    case 5: {
      const restrictions = f.dietRestrictions
        .filter((d): d is keyof typeof DIET_TEXT => d !== 'none' && d !== 'intolerance')
        .map((d) => DIET_TEXT[d]);
      if (f.dietRestrictions.includes('intolerance') && f.intoleranceText.trim()) restrictions.push(`Intolerância: ${f.intoleranceText.trim()}`);
      const answers: Record<string, unknown> = {
        dietRestrictions: f.dietRestrictions,
        intoleranceText: f.dietRestrictions.includes('intolerance') ? f.intoleranceText.trim() : '',
      };
      if (f.mealsPerDay) answers.mealsPerDay = f.mealsPerDay;
      if (f.water) answers.water = f.water;
      answers.favoriteFoods = parseFavorites(f.favoriteFoods);
      return { restrictions, onboarding: { step: resume, answers } };
    }
    case 6:
      // Preferências alimentares não vão no PUT /profile: têm endpoint próprio (PUT /preferences/foods).
      return { onboarding: { step: resume, answers: {} } };
    case 7:
      return { onboarding: { step: resume, answers: { injuries: f.injuries.trim(), followUp: f.followUp } } };
    default:
      return { onboarding: { step: LAST_STEP, answers: {} } };
  }
}

/** Tudo de uma vez (etapa final): garante que o servidor tem todas as respostas antes de gerar o plano. */
export function fullPayload(f: OnboardingForm): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const answers: Record<string, unknown> = {};
  for (let s = 1; s <= 7; s++) {
    const { onboarding, ...rest } = stepPayload(s, f) as { onboarding: { answers: Record<string, unknown> } } & Record<string, unknown>;
    Object.assign(merged, rest);
    Object.assign(answers, onboarding.answers);
  }
  return { ...merged, onboarding: { step: LAST_STEP, answers } };
}

// ---------- rascunho local e adiamento ----------

const DRAFT_KEY = 'fitos.onboarding.draft';
export const ONBOARDING_KEYS = [DRAFT_KEY];

interface Draft {
  step: number;
  form: OnboardingForm;
}

export async function loadDraft(): Promise<Draft | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    return raw ? ({ ...{ step: 1, form: emptyForm() }, ...JSON.parse(raw) } as Draft) : null;
  } catch {
    return null;
  }
}

export async function saveDraft(draft: Draft | null) {
  try {
    if (draft) await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else await AsyncStorage.removeItem(DRAFT_KEY);
  } catch {
    // sem armazenamento: o servidor ainda guarda o progresso
  }
}

// "Preencher depois": vale até fechar o app; no próximo login o questionário volta de onde parou.
let postponed = false;
export const postponeOnboarding = () => {
  postponed = true;
};
export const isOnboardingPostponed = () => postponed;
export const resetOnboardingPostponed = () => {
  postponed = false;
};
