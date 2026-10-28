import { z } from 'zod';
import { registrationFields } from '../../shared/professional-registration';
import { assignableRoles } from './admin-users.schemas';

export { COUNCILS_BY_ROLE, isProfessionalRole, type Council } from '../../shared/professional-registration';

/** `role: 'admin'` não está na lista: vira 400. Campos extras também (strictObject). */
export const createInviteSchema = z.strictObject({
  role: z.enum(assignableRoles),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  expiresInDays: z.number().int().min(1).max(14).optional(),
});

/** Sem `strict`: um `role` enviado no corpo é simplesmente ignorado; o papel vem do convite no servidor. */
export const acceptInviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72), // bcrypt ignora bytes após 72
  ...registrationFields,
});

export const tokenParamSchema = z.object({ token: z.string().min(32).max(200) });
export const idParamSchema = z.object({ id: z.string().uuid() });
export const pageQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) });
