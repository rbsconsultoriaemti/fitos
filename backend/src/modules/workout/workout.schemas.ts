import { z } from 'zod';

export const createExerciseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(40).default('strength'),
  muscleGroup: z.string().trim().min(2).max(60),
  equipment: z.string().trim().max(60).optional(),
  videoUrl: z.url().max(500).optional(),
});

export const listExercisesSchema = z.object({
  q: z.string().trim().max(120).optional(),
  muscleGroup: z.string().trim().max(60).optional(),
});

const setSchema = z.object({
  id: z.uuid().optional(), // só em PUT de plano `self`: identifica a série existente a atualizar
  exerciseId: z.uuid(),
  sets: z.number().int().min(1).max(20),
  reps: z.string().trim().regex(/^\d+(-\d+)?$/, 'Use "10" ou uma faixa como "8-12"'),
  loadKg: z.number().min(0).max(1000).optional(),
  restSeconds: z.number().int().min(0).max(1800).optional(),
});

const daySchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7), // 1 = segunda ... 7 = domingo
  muscleGroup: z.string().trim().min(2).max(60),
  notes: z.string().trim().max(1000).optional(),
  sets: z.array(setSchema).min(1).max(40),
});

const planContent = {
  title: z.string().trim().min(2).max(120),
  durationWeeks: z.number().int().min(1).max(104).optional(),
  days: z
    .array(daySchema)
    .min(1)
    .max(7)
    .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === days.length, 'dayOfWeek repetido'),
};

// `studentId` é obrigatório para o professor e ignorado para o aluno (plano próprio).
export const createPlanSchema = z.object({ studentId: z.uuid().optional(), ...planContent });
export const updatePlanSchema = z.object(planContent);

export const listPlansSchema = z.object({
  studentId: z.uuid().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

export const createLogSchema = z.object({
  planId: z.uuid(),
  dayId: z.uuid(),
  performedAt: z.iso.datetime().optional(),
  perceivedEffort: z.number().int().min(1).max(10).optional(),
  notes: z.string().trim().max(1000).optional(),
  sets: z
    .array(
      z.object({
        setId: z.uuid(),
        setsDone: z.number().int().min(0).max(50),
        loadDoneKg: z.number().min(0).max(1000).optional(),
        repsDone: z.number().int().min(0).max(1000).optional(),
      }),
    )
    .min(1)
    .max(60),
});

export const listLogsSchema = z.object({
  studentId: z.uuid().optional(),
  planId: z.uuid().optional(),
});

export type PlanContent = z.infer<typeof updatePlanSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type CreateLogInput = z.infer<typeof createLogSchema>;
