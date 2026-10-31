import { z } from 'zod';
import { portionsSchema } from '../nutrition/nutrition.schemas';

export const foodsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  hidden: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  glutenFree: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const foodIdParamSchema = z.object({ id: z.string().uuid() });

/** `strictObject`: campo extra vira 400. Os três campos são os que a tela de catálogo edita. */
export const foodPatchSchema = z
  .strictObject({
    glutenFree: z.boolean().optional(),
    hidden: z.boolean().optional(),
    portions: portionsSchema.optional(),
  })
  .refine((b) => b.glutenFree !== undefined || b.hidden !== undefined || b.portions !== undefined, {
    message: 'Informe ao menos um campo: glutenFree, hidden ou portions',
  });
