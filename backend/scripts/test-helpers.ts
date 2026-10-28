/** Ajudantes dos testes que cadastram profissionais: o cadastro público exige registro e deixa a conta pendente. */
import type { Pool } from 'pg';

const PROFESSIONAL = ['trainer', 'running_coach', 'cycling_coach', 'nutritionist', 'psychologist'];

/** Campos de registro profissional aceitos para o papel (vazio para aluno). */
export function registrationFor(role: string): Record<string, string> {
  if (!PROFESSIONAL.includes(role)) return {};
  const council = role === 'nutritionist' ? 'CRN' : role === 'psychologist' ? 'CRP' : 'CREF';
  return { registrationCouncil: council, registrationNumber: '123456', registrationState: 'SP' };
}

/** Simula a validação do administrador direto no banco (os testes que precisam de um profissional já aprovado). */
export async function approveProfessional(pool: Pool, id: string): Promise<void> {
  await pool.query("UPDATE users SET validation_status = 'approved' WHERE id = $1", [id]);
}

export const isProfessional = (role: string) => PROFESSIONAL.includes(role);
