import { z } from 'zod';
import { onboardingProgressSchema } from '../onboarding/onboarding.schemas';

// Todos os campos são opcionais; `null` apaga o valor. Campos ausentes não são alterados.
export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD')
    .refine((d) => {
      const date = new Date(`${d}T12:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(d) && date <= new Date() && date.getUTCFullYear() >= 1900;
    }, 'Data de nascimento inválida')
    .nullable()
    .optional(),
  sex: z.enum(['male', 'female', 'other']).nullable().optional(),
  heightCm: z.number().min(50).max(260).nullable().optional(),
  weightKg: z.number().min(20).max(500).nullable().optional(),
  bodyFatPct: z.number().min(1).max(70).nullable().optional(),
  restingHrBpm: z.number().int().min(20).max(200).nullable().optional(),
  maxHrBpm: z.number().int().min(80).max(260).nullable().optional(),
  goal: z.string().trim().max(500).nullable().optional(),
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced']).nullable().optional(),
  restrictions: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  // Progresso do questionário de onboarding (etapa de retomada + respostas dadas até agora).
  onboarding: onboardingProgressSchema.optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
