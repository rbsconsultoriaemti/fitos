/**
 * Webhook do RevenueCat (/billing/revenuecat/webhook): assinatura gravada, idempotência, ordem dos eventos e sandbox.
 *
 *   npm run test:billing
 *
 * Altera dados: só roda no banco local (ver scripts/local-only.ts).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertLocalOnly } from './local-only';

// Configuração de teste antes de carregar a aplicação (config.ts lê as variáveis na importação).
const AUTH = 'segredo-teste-revenuecat';
process.env.REVENUECAT_WEBHOOK_AUTH = AUTH;
process.env.REVENUECAT_ACCEPT_SANDBOX = 'false';
const PORT = 3996;
const DAY = 86_400_000;

let failures = 0;
const check = (ok: boolean, what: string, extra?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${what}${!ok && extra !== undefined ? ` → ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
};

async function main() {
  assertLocalOnly('test:billing');
  const { createApp } = await import('../src/app');
  const { getPlan } = await import('../src/modules/quotas/quotas.service');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const stamp = Date.now().toString(36);
  const now = Date.now();
  const key = `${stamp}-orig`;
  const server = createApp().listen(PORT);
  await new Promise((r) => setTimeout(r, 300));

  try {
    const { rows: [user] } = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Teste RC', $1, 'x', 'student') RETURNING id`,
      [`rc-${stamp}@teste.local`],
    );
    const uid = user.id;

    const post = async (event: Record<string, unknown>, auth: string | null = AUTH) => {
      const r = await fetch(`http://localhost:${PORT}/billing/revenuecat/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ api_version: '1.0', event }),
      });
      return { status: r.status, body: (await r.json().catch(() => null)) as { outcome?: string } | null };
    };
    const event = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
      id: `${stamp}-${id}`,
      type,
      app_user_id: uid,
      product_id: 'fitos_premium_mensal',
      store: 'PLAY_STORE',
      original_transaction_id: key,
      environment: 'PRODUCTION',
      period_type: 'NORMAL',
      event_timestamp_ms: now,
      expiration_at_ms: now + 30 * DAY,
      ...extra,
    });
    const sub = async (k = key) => (await pool.query('SELECT * FROM subscriptions WHERE revenuecat_id = $1', [k])).rows[0];
    const daysLeft = (row: { expires_at: Date | null }) => (row.expires_at ? (row.expires_at.getTime() - Date.now()) / DAY : -1);

    console.log('— Autenticação —');
    check((await post(event('a1', 'INITIAL_PURCHASE'), null)).status === 401, 'sem cabeçalho Authorization => 401');
    check((await post(event('a2', 'INITIAL_PURCHASE'), 'errado')).status === 401, 'cabeçalho errado => 401');
    check((await pool.query('SELECT 1 FROM revenuecat_events WHERE event_id LIKE $1', [`${stamp}-a%`])).rowCount === 0, 'recusados não ficam registrados');

    console.log('— Compra e renovação —');
    let r = await post(event('e1', 'INITIAL_PURCHASE'));
    check(r.status === 200 && r.body?.outcome === 'applied', 'compra inicial aplicada', r);
    let s = await sub();
    check(s?.status === 'active' && s?.plan === 'premium' && s?.environment === 'PRODUCTION' && s?.auto_renew === true && s?.store === 'PLAY_STORE', 'assinatura ativa, premium, produção, com renovação', s);
    check((await getPlan(uid)) === 'paid', 'cotas: plano pago liberado');

    r = await post(event('e1', 'INITIAL_PURCHASE'));
    check(r.body?.outcome === 'duplicate', 'mesmo evento de novo => duplicate');
    check((await pool.query('SELECT count(*)::int AS n FROM subscriptions WHERE revenuecat_id = $1', [key])).rows[0].n === 1, 'duplicata não cria segunda assinatura');

    r = await post(event('e2', 'RENEWAL', { event_timestamp_ms: now + 1000, expiration_at_ms: now + 60 * DAY }));
    check(r.body?.outcome === 'applied' && daysLeft(await sub()) > 55, 'renovação estende a validade', r);

    console.log('— Ordem dos eventos —');
    r = await post(event('e0', 'EXPIRATION', { event_timestamp_ms: now - 10_000, expiration_at_ms: now + 5 * DAY }));
    s = await sub();
    check(r.body?.outcome === 'stale' && s.status === 'active' && daysLeft(s) > 55, 'evento mais antigo não sobrescreve o mais novo', { r, s });

    console.log('— Cancelamento —');
    r = await post(event('e3', 'CANCELLATION', { event_timestamp_ms: now + 2000 }));
    s = await sub();
    check(r.body?.outcome === 'applied' && s.status === 'active' && s.auto_renew === false, 'cancelamento mantém o acesso e desliga a renovação', s);
    check((await getPlan(uid)) === 'paid', 'cancelado ainda dentro do período segue pago');
    r = await post(event('e3b', 'CANCELLATION', { original_transaction_id: `${stamp}-desconhecida` }));
    check(r.body?.outcome === 'ignored' && !(await sub(`${stamp}-desconhecida`)), 'cancelamento de assinatura desconhecida é ignorado');

    console.log('— Cobrança, expiração e volta —');
    r = await post(event('e4', 'BILLING_ISSUE', { event_timestamp_ms: now + 3000 }));
    check(r.body?.outcome === 'applied' && (await sub()).status === 'past_due' && (await getPlan(uid)) === 'free', 'falha de cobrança tira o plano pago', r);
    r = await post(event('e5', 'EXPIRATION', { event_timestamp_ms: now + 4000, expiration_at_ms: now - DAY }));
    check(r.body?.outcome === 'applied' && (await sub()).status === 'expired' && (await getPlan(uid)) === 'free', 'expiração vira gratuito');
    r = await post(event('e6', 'RENEWAL', { event_timestamp_ms: now + 6000, expiration_at_ms: now + 30 * DAY }));
    s = await sub();
    check(r.body?.outcome === 'applied' && s.status === 'active' && (await getPlan(uid)) === 'paid', 'nova compra reativa o plano pago', s);

    console.log('— Sandbox, usuário desconhecido e tipos sem efeito —');
    r = await post(event('e7', 'RENEWAL', { environment: 'SANDBOX', event_timestamp_ms: now + 7000, expiration_at_ms: now + 90 * DAY }));
    check(r.body?.outcome === 'sandbox_skipped' && daysLeft(await sub()) < 40, 'evento de sandbox não concede acesso', r);
    r = await post(event('e8', 'INITIAL_PURCHASE', { app_user_id: randomUUID(), original_transaction_id: `${stamp}-x1` }));
    check(r.status === 200 && r.body?.outcome === 'unknown_user', 'usuário inexistente => unknown_user (sem erro, sem reenvio)', r);
    r = await post(event('e9', 'INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:abc', original_transaction_id: `${stamp}-x2` }));
    check(r.body?.outcome === 'unknown_user', 'id anônimo do RevenueCat => unknown_user', r);
    r = await post(event('e10', 'TEST'));
    check(r.body?.outcome === 'ignored', 'evento TEST não altera assinatura', r);

    console.log('— Registro dos eventos —');
    const { rows } = await pool.query<{ outcome: string }>('SELECT outcome FROM revenuecat_events WHERE event_id LIKE $1', [`${stamp}-%`]);
    const count = (o: string) => rows.filter((x) => x.outcome === o).length;
    // e1, e2, e0, e3, e3b, e4, e5, e6, e7, e8, e9, e10 (a duplicata e1 e os recusados por 401 não entram aqui)
    check(rows.length === 12 && count('applied') === 6 && count('stale') === 1 && count('sandbox_skipped') === 1, 'cada evento processado fica registrado com o resultado', rows.length);
  } finally {
    await pool.query('DELETE FROM revenuecat_events WHERE event_id LIKE $1', [`${stamp}%`]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE email = $1", [`rc-${stamp}@teste.local`]).catch(() => undefined);
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? '\nTodos os testes passaram.' : `\n${failures} verificação(ões) falharam.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
