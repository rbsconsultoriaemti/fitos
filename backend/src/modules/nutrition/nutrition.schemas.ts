import { z } from 'zod';

export const listFoodsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  // "true": só alimentos marcados como sem glúten.
  glutenFree: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const portionsSchema = z
  .array(z.object({ label: z.string().trim().min(1).max(40), grams: z.number().positive().max(5000) }))
  .max(12)
  .refine((ps) => new Set(ps.map((p) => p.label.toLowerCase())).size === ps.length, 'Rótulo de porção repetido');

export const setPortionsSchema = z.object({ portions: portionsSchema });

export const createFoodSchema = z.object({
  portions: portionsSchema.optional(),
  name: z.string().trim().min(2).max(160),
  kcalPer100g: z.number().min(0).max(1000),
  proteinPer100g: z.number().min(0).max(100),
  carbPer100g: z.number().min(0).max(100),
  fatPer100g: z.number().min(0).max(100),
  barcode: z.string().trim().max(32).optional(),
});

const mealSchema = z.object({
  name: z.string().trim().min(2).max(80),
  timeSuggestion: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM').optional(),
  foods: z
    .array(z.object({ foodId: z.uuid(), quantityG: z.number().positive().max(5000) }))
    .min(1)
    .max(30),
});

const planContent = {
  title: z.string().trim().min(2).max(120),
  targetKcal: z.number().positive().max(10000).optional(),
  targetProteinG: z.number().min(0).max(1000).optional(),
  targetCarbG: z.number().min(0).max(1500).optional(),
  targetFatG: z.number().min(0).max(1000).optional(),
  // Pode ser um plano só com metas (sem refeições montadas), útil para acompanhar o dia contra a meta.
  meals: z.array(mealSchema).max(12).default([]),
};

const hasContent = (p: { meals: unknown[]; targetKcal?: number; targetProteinG?: number; targetCarbG?: number; targetFatG?: number }) =>
  p.meals.length > 0 ||
  [p.targetKcal, p.targetProteinG, p.targetCarbG, p.targetFatG].some((t) => t !== undefined);
const CONTENT_MSG = 'Informe ao menos uma refeição ou uma meta';

// `patientId` é obrigatório para o nutricionista e ignorado para o aluno (plano próprio).
export const createPlanSchema = z
  .object({ patientId: z.uuid().optional(), ...planContent })
  .refine(hasContent, CONTENT_MSG);
export const updatePlanSchema = z.object(planContent).refine(hasContent, CONTENT_MSG);

export const listPlansSchema = z.object({
  patientId: z.uuid().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

// Café, lanche da manhã, almoço, lanche da tarde, jantar (ordem de exibição).
export const mealTypes = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner'] as const;
// 'snack' é o tipo antigo (apps antigos e filas offline): vira lanche da manhã/tarde pelo horário.
export const mealInputTypes = [...mealTypes, 'snack'] as const;

// Quantidade: em gramas OU em porções caseiras do alimento (ex.: 2 × "fatia"). Exatamente uma das duas.
const quantityFields = {
  quantityG: z.number().positive().max(5000).optional(),
  portion: z
    .object({ label: z.string().trim().min(1).max(40), count: z.number().positive().max(100).default(1) })
    .optional(),
};
const oneQuantity = (v: { quantityG?: number; portion?: unknown }) => (v.quantityG === undefined) !== (v.portion === undefined);
const QUANTITY_MSG = 'Informe quantityG ou portion (apenas um)';

export const createLogSchema = z.object({
  items: z
    .array(
      z
        .object({
          foodId: z.uuid(),
          mealType: z.enum(mealInputTypes),
          mealId: z.uuid().optional(), // refeição do plano alimentar ativo, opcional
          ...quantityFields,
        })
        .refine(oneQuantity, QUANTITY_MSG),
    )
    .min(1)
    .max(30),
  loggedAt: z.iso.datetime().optional(),
  recognitionSource: z.enum(['manual', 'photo_ai']).default('manual'),
});

export const updateLogSchema = z
  .object({
    mealType: z.enum(mealInputTypes).optional(),
    loggedAt: z.iso.datetime().optional(),
    ...quantityFields,
  })
  .refine((v) => !(v.quantityG !== undefined && v.portion !== undefined), QUANTITY_MSG)
  .refine((v) => v.mealType !== undefined || v.loggedAt !== undefined || v.quantityG !== undefined || v.portion !== undefined, 'Nada para atualizar');

export const listLogsSchema = z.object({
  date: z.iso.date().optional(), // YYYY-MM-DD no fuso de config.timezone; padrão: hoje
  userId: z.uuid().optional(),
});

export const barcodeParam = z.object({ code: z.string().regex(/^\d{8,14}$/, 'Código de barras inválido') });

// Refeições favoritas
const templateItemSchema = z
  .object({ foodId: z.uuid(), ...quantityFields })
  .refine(oneQuantity, QUANTITY_MSG);

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mealType: z.enum(mealTypes).optional(),
  items: z.array(templateItemSchema).min(1).max(30),
});

export const applyTemplateSchema = z.object({
  mealType: z.enum(mealInputTypes).optional(),
  loggedAt: z.iso.datetime().optional(),
});

// Meta de calorias: `overrideKcal: null` volta para a meta calculada.
export const energyTargetQuerySchema = z.object({ date: z.iso.date().optional() });
export const setEnergyTargetSchema = z.object({ overrideKcal: z.number().int().min(800).max(10000).nullable() });

export type PlanContent = z.infer<typeof updatePlanSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type CreateLogInput = z.infer<typeof createLogSchema>;
export type UpdateLogInput = z.infer<typeof updateLogSchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>;

// Água: aceita `amountMl` (padrão da API) ou `amount_ml`. `loggedAt` permite à fila offline do app mandar a hora real do gole.
export const createWaterSchema = z
  .object({
    amountMl: z.number().int().min(1).max(2000).optional(),
    amount_ml: z.number().int().min(1).max(2000).optional(),
    loggedAt: z.iso
      .datetime({ offset: true })
      .refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000 && Date.parse(v) >= Date.now() - 3 * 86_400_000, 'loggedAt fora do intervalo aceito')
      .optional(),
    clientId: z.string().trim().min(8).max(64).optional(),
  })
  .refine((v) => v.amountMl !== undefined || v.amount_ml !== undefined, { message: 'Informe amountMl', path: ['amountMl'] })
  .transform((v) => ({ amountMl: (v.amountMl ?? v.amount_ml)!, loggedAt: v.loggedAt, clientId: v.clientId }));
export type CreateWaterInput = z.infer<typeof createWaterSchema>;

export const waterTodaySchema = z.object({ date: z.iso.date().optional() });
