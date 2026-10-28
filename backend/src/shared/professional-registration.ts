import { z } from 'zod';
import { AppError } from './errors';

export const PROFESSIONAL_ROLES = ['trainer', 'running_coach', 'cycling_coach', 'nutritionist', 'psychologist'] as const;
export type ProfessionalRole = (typeof PROFESSIONAL_ROLES)[number];

export const COUNCILS = ['CRN', 'CREF', 'CRP', 'SEM_CONSELHO'] as const;
export type Council = (typeof COUNCILS)[number];

/** Conselho aceito por papel: nutrição = CRN, psicologia = CRP, musculação = CREF; corrida e ciclismo = CREF ou sem conselho. */
export const COUNCILS_BY_ROLE: Record<ProfessionalRole, readonly Council[]> = {
  trainer: ['CREF'],
  nutritionist: ['CRN'],
  psychologist: ['CRP'],
  running_coach: ['CREF', 'SEM_CONSELHO'],
  cycling_coach: ['CREF', 'SEM_CONSELHO'],
};

export const isProfessionalRole = (role: string): role is ProfessionalRole => (PROFESSIONAL_ROLES as readonly string[]).includes(role);

/** Campos opcionais no corpo; a exigência por papel é conferida em `normalizeRegistration`. */
export const registrationFields = {
  registrationCouncil: z.enum(COUNCILS).optional(),
  registrationNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z./-]{2,30}$/, 'Número de registro inválido')
    .optional(),
};

/**
 * Registro profissional obrigatório para quem entra como profissional (cadastro público ou convite). Devolve o que
 * será gravado; 400 se faltar, se o conselho não for o do papel ou se faltar o número (exceto SEM_CONSELHO).
 */
export function normalizeRegistration(role: ProfessionalRole, council?: Council, number?: string): { council: Council; number: string | null } {
  if (!council) throw new AppError(400, 'registration_required', 'Informe o conselho e o número de registro profissional');
  if (!COUNCILS_BY_ROLE[role].includes(council)) {
    throw new AppError(400, 'registration_council_invalid', `Conselho inválido para este papel (aceitos: ${COUNCILS_BY_ROLE[role].join(', ')})`);
  }
  if (council !== 'SEM_CONSELHO' && !number) throw new AppError(400, 'registration_required', 'Informe o número de registro profissional');
  return { council, number: council === 'SEM_CONSELHO' ? null : (number ?? null) };
}
