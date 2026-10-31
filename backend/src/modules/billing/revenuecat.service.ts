import { timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../../database/pool';
import { config } from '../../shared/config';

/** Campos do evento de webhook do RevenueCat que usamos. O restante do corpo é ignorado. */
export interface RcEvent {
  id: string;
  type: string;
  app_user_id?: string | null;
  product_id?: string | null;
  store?: string | null;
  original_transaction_id?: string | null;
  transaction_id?: string | null;
  environment?: string | null;
  period_type?: string | null;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number | null;
}

export type Outcome = 'applied' | 'stale' | 'ignored' | 'unknown_user' | 'sandbox_skipped' | 'duplicate';

type SubStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confere o cabeçalho Authorization em tempo constante. Sem segredo configurado, recusa tudo. */
export function isAuthorized(header: string | undefined): boolean {
  const expected = config.revenuecat.webhookAuth;
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Estado que cada evento produz. `keepStatus` = mantém o estado atual (cancelamento: o aluno segue com acesso até o fim
 * do período pago). Tipos fora da lista (TEST, TRANSFER, desconhecidos) não alteram a assinatura.
 */
function transition(type: string, periodType: string | null | undefined): { status: SubStatus; keepStatus: boolean; autoRenew: boolean } | null {
  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
      return { status: periodType === 'TRIAL' ? 'trialing' : 'active', keepStatus: false, autoRenew: true };
    case 'NON_RENEWING_PURCHASE':
      return { status: 'active', keepStatus: false, autoRenew: false };
    case 'CANCELLATION':
      return { status: 'active', keepStatus: true, autoRenew: false };
    case 'BILLING_ISSUE':
      return { status: 'past_due', keepStatus: false, autoRenew: true };
    case 'SUBSCRIPTION_PAUSED':
      return { status: 'canceled', keepStatus: false, autoRenew: false };
    case 'EXPIRATION':
      return { status: 'expired', keepStatus: false, autoRenew: false };
    default:
      return null;
  }
}

/**
 * Processa um evento em uma transação. O evento é gravado primeiro: se já existir, é duplicado e nada muda. Se o
 * processamento falhar, a transação inteira volta e o RevenueCat reenvia o evento.
 */
export async function processEvent(ev: RcEvent): Promise<Outcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO revenuecat_events (event_id, type, app_user_id, product_id, environment, outcome, event_at)
       VALUES ($1, $2, $3, $4, $5, 'ignored', $6)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [ev.id, ev.type, ev.app_user_id ?? null, ev.product_id ?? null, ev.environment ?? null, ev.event_timestamp_ms ? new Date(ev.event_timestamp_ms) : null],
    );
    if (inserted.rowCount === 0) {
      await client.query('ROLLBACK');
      return 'duplicate';
    }
    const outcome = await applyEvent(client, ev);
    await client.query('UPDATE revenuecat_events SET outcome = $2 WHERE event_id = $1', [ev.id, outcome]);
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function applyEvent(client: PoolClient, ev: RcEvent): Promise<Outcome> {
  const t = transition(ev.type, ev.period_type);
  const key = ev.original_transaction_id ?? ev.transaction_id ?? null;
  if (!t || !ev.app_user_id || !key) return 'ignored';

  // Só produção concede acesso. Sem o campo, tratamos como sandbox (seguro por padrão).
  const environment = ev.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
  if (environment !== 'PRODUCTION' && !config.revenuecat.acceptSandbox) return 'sandbox_skipped';

  // O app deve identificar a compra com o id do usuário (Purchases.logIn). Outro valor não corresponde a conta nenhuma.
  if (!UUID.test(ev.app_user_id)) return 'unknown_user';
  const user = await client.query('SELECT 1 FROM users WHERE id = $1', [ev.app_user_id]);
  if (!user.rowCount) return 'unknown_user';

  const existing = await client.query('SELECT 1 FROM subscriptions WHERE revenuecat_id = $1', [key]);
  if (t.keepStatus && !existing.rowCount) return 'ignored'; // cancelamento de uma assinatura que não conhecemos

  const expiresAt = ev.expiration_at_ms ? new Date(ev.expiration_at_ms) : null;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO subscriptions (user_id, plan, status, expires_at, revenuecat_id, store, product_id, environment, auto_renew, last_event_at_ms)
     VALUES ($1, 'premium', $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (revenuecat_id) WHERE revenuecat_id IS NOT NULL DO UPDATE SET
       status           = CASE WHEN $10 THEN subscriptions.status ELSE EXCLUDED.status END,
       expires_at       = EXCLUDED.expires_at,
       store            = EXCLUDED.store,
       product_id       = EXCLUDED.product_id,
       environment      = EXCLUDED.environment,
       auto_renew       = EXCLUDED.auto_renew,
       last_event_at_ms = EXCLUDED.last_event_at_ms,
       updated_at       = now()
     WHERE subscriptions.last_event_at_ms IS NULL OR subscriptions.last_event_at_ms < EXCLUDED.last_event_at_ms
     RETURNING id`,
    [ev.app_user_id, t.status, expiresAt, key, ev.store ?? null, ev.product_id ?? null, environment, t.autoRenew, ev.event_timestamp_ms ?? 0, t.keepStatus],
  );
  // Sem linha de retorno: o evento é mais antigo que o último já aplicado nesta assinatura.
  return rows.length ? 'applied' : 'stale';
}
