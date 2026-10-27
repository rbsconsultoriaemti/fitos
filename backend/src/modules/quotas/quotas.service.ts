import type { PoolClient } from 'pg';
import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';

export type QuotaKind = 'photo_recognition' | 'ai_workout_plan';
export type QuotaPlan = 'free' | 'paid';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Limites por plano (CLAUDE.md, "Limites por plano"). Janela deslizante: conta os usos dos últimos `windowMs`. */
export const QUOTA_RULES: Record<QuotaKind, Record<QuotaPlan, { limit: number; windowMs: number }>> = {
  photo_recognition: { free: { limit: 10, windowMs: 30 * DAY }, paid: { limit: 20, windowMs: DAY } },
  ai_workout_plan: { free: { limit: 1, windowMs: 90 * DAY }, paid: { limit: 1, windowMs: 7 * DAY } },
};

export interface QuotaStatus {
  kind: QuotaKind;
  plan: QuotaPlan;
  limit: number;
  used: number;
  remaining: number;
  windowMs: number;
  /** Quando libera: com a cota esgotada, o momento em que uma vaga abre; senão, quando o uso mais antigo sai da janela. Nulo sem uso. */
  resetsAt: string | null;
}

type Db = Pick<PoolClient, 'query'>;

/** Pago = assinatura premium ativa e dentro da validade. Sem assinatura (ou vencida) vale o plano gratuito. */
export async function getPlan(userId: string, db: Db = pool): Promise<QuotaPlan> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM subscriptions
      WHERE user_id = $1 AND plan = 'premium' AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [userId],
  );
  return rowCount ? 'paid' : 'free';
}

export async function getQuotaStatus(userId: string, kind: QuotaKind, db: Db = pool): Promise<QuotaStatus> {
  const plan = await getPlan(userId, db);
  const { limit, windowMs } = QUOTA_RULES[kind][plan];
  const { rows } = await db.query<{ used_at: Date }>(
    `SELECT used_at FROM usage_quotas
      WHERE user_id = $1 AND kind = $2 AND used_at > now() - ($3::bigint * interval '1 millisecond')
      ORDER BY used_at ASC`,
    [userId, kind, windowMs],
  );
  const used = rows.length;
  // A vaga que abre primeiro é a do (used - limit + 1)º uso mais antigo; sem exceder o limite, é o mais antigo.
  const freeing = used === 0 ? null : rows[Math.max(0, used - limit)].used_at;
  return {
    kind,
    plan,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    windowMs,
    resetsAt: freeing ? new Date(freeing.getTime() + windowMs).toISOString() : null,
  };
}

/** Registra um uso. Chamar só DEPOIS do sucesso da IA (de preferência na mesma transação que grava o resultado). */
export async function consumeQuota(userId: string, kind: QuotaKind, refId: string | null = null, db: Db = pool) {
  await db.query(`INSERT INTO usage_quotas (user_id, kind, ref_id) VALUES ($1, $2, $3)`, [userId, kind, refId]);
}

const fmtTime = new Intl.DateTimeFormat('pt-BR', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit', hour12: false });
const fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "às 14h", "amanhã às 9h30" ou "em 12 dias". */
export function releaseText(resetsAt: Date, now = new Date()): string {
  const diff = resetsAt.getTime() - now.getTime();
  if (diff < DAY) {
    const [h, m] = fmtTime.format(resetsAt).split(':');
    const clock = `${Number(h)}h${m === '00' ? '' : m}`;
    return fmtDay.format(resetsAt) === fmtDay.format(now) ? `às ${clock}` : `amanhã às ${clock}`;
  }
  const days = Math.ceil(diff / DAY);
  return `em ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

export function exceededMessage(s: QuotaStatus, now = new Date()): string {
  const when = s.resetsAt ? `libera ${releaseText(new Date(s.resetsAt), now)}` : 'tente novamente mais tarde';
  if (s.kind === 'photo_recognition') {
    const period = s.plan === 'paid' ? 'de hoje' : 'dos últimos 30 dias';
    return `Você já usou as ${s.limit} fotos ${period}; ${when}.`;
  }
  return `Você já gerou o plano de treino por IA neste período; ${when}.`;
}

export function quotaExceededError(s: QuotaStatus) {
  return new AppError(429, 'quota_exceeded', exceededMessage(s), undefined, { resetsAt: s.resetsAt, limit: s.limit, used: s.used, plan: s.plan });
}

/** Lança 429 se não houver vaga. Não consome. */
export async function assertQuota(userId: string, kind: QuotaKind) {
  const s = await getQuotaStatus(userId, kind);
  if (s.remaining <= 0) throw quotaExceededError(s);
}
