import { z } from 'zod';

export const GOAL_LABELS = {
  lose_fat: 'Perder gordura',
  gain_muscle: 'Ganhar massa muscular',
  conditioning: 'Melhorar condicionamento',
  maintain: 'Manter peso e saúde',
  race: 'Preparação para prova',
} as const;

export const DIET_LABELS = {
  vegetarian: 'Vegetariano',
  vegan: 'Vegano',
  gluten_free: 'Sem glúten',
  lactose_free: 'Sem lactose',
} as const;

// Respostas do questionário que não têm coluna própria em `profiles` (ficam em profiles.onboarding).
export const onboardingAnswersSchema = z.object({
  goalKey: z.enum(['lose_fat', 'gain_muscle', 'conditioning', 'maintain', 'race']),
  raceType: z.enum(['running', 'cycling']).nullable(),
  daysPerWeek: z.number().int().min(2).max(6),
  sessionMinutes: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]),
  location: z.enum(['gym', 'home', 'outdoor', 'mixed']),
  modalities: z.array(z.enum(['strength', 'running', 'cycling', 'functional', 'other'])).min(1).max(5),
  dietRestrictions: z.array(z.enum(['none', 'vegetarian', 'vegan', 'gluten_free', 'lactose_free', 'intolerance'])).max(6),
  intoleranceText: z.string().trim().max(200),
  mealsPerDay: z.number().int().min(3).max(6),
  water: z.enum(['lt1', '1to2', 'gt2']),
  injuries: z.string().trim().max(500),
  followUp: z.array(z.enum(['none', 'personal', 'nutritionist', 'doctor', 'psychologist'])).max(5),
});

// Na conclusão, as etapas opcionais (alimentação e saúde) podem ter sido puladas: valem os padrões abaixo.
export const completeAnswersSchema = onboardingAnswersSchema.extend({
  dietRestrictions: onboardingAnswersSchema.shape.dietRestrictions.default([]),
  intoleranceText: onboardingAnswersSchema.shape.intoleranceText.default(''),
  mealsPerDay: onboardingAnswersSchema.shape.mealsPerDay.default(4),
  water: onboardingAnswersSchema.shape.water.default('1to2'),
  injuries: onboardingAnswersSchema.shape.injuries.default(''),
  followUp: onboardingAnswersSchema.shape.followUp.default([]),
});

export type OnboardingAnswers = z.infer<typeof completeAnswersSchema>;

// Cada etapa salva só o que respondeu; `step` é a etapa em que o usuário retoma (1..7).
export const onboardingProgressSchema = z.object({
  step: z.number().int().min(1).max(7),
  answers: onboardingAnswersSchema.partial(),
});

export type OnboardingProgress = z.infer<typeof onboardingProgressSchema>;
