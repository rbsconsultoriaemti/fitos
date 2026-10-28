import { z } from 'zod';

/** Papéis de negócio que o administrador pode atribuir. `admin` NÃO está aqui de propósito. */
export const assignableRoles = ['student', 'trainer', 'running_coach', 'cycling_coach', 'nutritionist', 'psychologist'] as const;

export const PAGE_SIZE = 50;

export const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

/** `strictObject`: qualquer campo extra (inclusive `isPlatformAdmin`) vira 400. */
export const patchBodySchema = z
  .strictObject({
    role: z.enum(assignableRoles).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => b.role !== undefined || b.isActive !== undefined, { message: 'Informe role ou isActive' });

export const auditQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
