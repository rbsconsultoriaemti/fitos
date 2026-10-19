import { z } from 'zod';

export const listFoodsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
});

export const createFoodSchema = z.object({
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
  meals: z.array(mealSchema).min(1).max(12),
};

// `patientId` é obrigatório para o nutricionista e ignorado para o aluno (plano próprio).
export const createPlanSchema = z.object({ patientId: z.uuid().optional(), ...planContent });
export const updatePlanSchema = z.object(planContent);

export const listPlansSchema = z.object({
  patientId: z.uuid().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

export const createLogSchema = z.object({
  items: z
    .array(
      z.object({
        foodId: z.uuid(),
        quantityG: z.number().positive().max(5000),
        mealId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(30),
  loggedAt: z.iso.datetime().optional(),
  recognitionSource: z.enum(['manual', 'photo_ai']).default('manual'),
});

export const listLogsSchema = z.object({
  date: z.iso.date().optional(), // YYYY-MM-DD no fuso de config.timezone; padrão: hoje
  userId: z.uuid().optional(),
});

export type PlanContent = z.infer<typeof updatePlanSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type CreateLogInput = z.infer<typeof createLogSchema>;
