import { api } from './api';

// Contador de cotas por plano (backend: GET /quotas, CLAUDE.md "Limites por plano").

export type QuotaKind = 'photo_recognition' | 'ai_workout_plan';

export interface QuotaStatus {
  kind: QuotaKind;
  plan: 'free' | 'paid';
  limit: number;
  used: number;
  remaining: number;
  windowMs: number;
  /** ISO. Com a cota esgotada: quando abre uma vaga. Sem uso: null. */
  resetsAt: string | null;
}

export interface QuotasResponse {
  photo_recognition: QuotaStatus;
  ai_workout_plan: QuotaStatus;
}

export const fetchQuotas = () => api<QuotasResponse>('/quotas');

const DAY = 24 * 3_600_000;

/** "às 14h", "amanhã às 9h30", "em 12/11 às 6h" — no horário do aparelho (o Brasil tem um fuso só). */
export function releaseText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const hh = d.getHours();
  const mm = d.getMinutes();
  const clock = `${hh}h${mm === 0 ? '' : String(mm).padStart(2, '0')}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `às ${clock}`;
  const tomorrow = new Date(now.getTime() + DAY).toDateString() === d.toDateString();
  if (tomorrow) return `amanhã às ${clock}`;
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `em ${dd}/${mo} às ${clock}`;
}

/** Linha do contador da foto: "Restam 7 de 10 fotos nos últimos 30 dias" ou "Limite atingido; libera amanhã às 9h". */
export function photoQuotaText(q: QuotaStatus): string {
  const period = q.plan === 'paid' ? 'nas últimas 24 h' : 'nos últimos 30 dias';
  if (q.remaining > 0) {
    return `Restam ${q.remaining} de ${q.limit} fotos ${period}.`;
  }
  const when = q.resetsAt ? ` Libera ${releaseText(q.resetsAt)}.` : '';
  return `Você usou as ${q.limit} fotos ${period}.${when}`;
}
