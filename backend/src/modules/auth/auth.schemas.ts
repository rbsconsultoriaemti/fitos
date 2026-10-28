import { z } from 'zod';
import { registrationFields } from '../../shared/professional-registration';

// Papéis que podem se cadastrar sozinhos. `admin` nunca é criado por registro público.
export const registrableRoles = [
  'student',
  'trainer',
  'running_coach',
  'cycling_coach',
  'nutritionist',
  'psychologist',
] as const;

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72), // bcrypt ignora bytes após 72
  role: z.enum(registrableRoles).default('student'),
  // Obrigatórios para papel profissional (conferidos em auth.service); ignorados para aluno.
  ...registrationFields,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
