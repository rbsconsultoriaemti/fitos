/**
 * Teste das cotas por plano: janela deslizante, gratuito x pago, 429 com mensagem/resetsAt, GET /quotas e
 * que falha da IA não consome cota. (O consumo no sucesso do plano de treino é verificado em `npm run test:onboarding`.)
 *
 *   npm run test:quotas
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';
import { consumeQuota, getQuotaStatus, releaseText } from '../src/modules/quotas/quotas.service';

const PORT = 3994;
const API = `http://localhost:${PORT}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let failures = 0;
const check = (ok: boolean, what: string, extra?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${what}${!ok && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
};
const killPort = (port: number) => {
  if (process.platform === 'win32') {
    try {
      execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`, { stdio: 'ignore' });
    } catch {
      /* nada a encerrar */
    }
  }
};

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function main() {
  // AI_SERVICE_TOKEN vazio => o reconhecimento falha com 503 (simula a IA fora do ar sem gastar nada).
  const server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), AI_SERVICE_TOKEN: '' }, shell: true });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) break;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const stamp = Date.now();
  const emails: string[] = [];
  const register = async (tag: string) => {
    const email = `quota-${tag}-${stamp}@teste.local`;
    emails.push(email);
    const r = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Teste Cota', email, password: 'SenhaTeste123!', role: 'student' }) });
    const token = ((await r.json()) as { accessToken: string }).accessToken;
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    return { token, id: rows[0].id as string };
  };
  const addUse = (userId: string, kind: string, ageMs: number, n = 1) =>
    pool.query(`INSERT INTO usage_quotas (user_id, kind, used_at) SELECT $1, $2, now() - ($3::bigint * interval '1 millisecond') FROM generate_series(1, $4::int)`, [userId, kind, Math.round(ageMs), n]);
  const clear = (userId: string) => pool.query('DELETE FROM usage_quotas WHERE user_id = $1', [userId]);
  const tinyImage = { imageBase64: Buffer.from('x').toString('base64'), mimeType: 'image/jpeg' };

  try {
    console.log('— Texto de "quando libera" —');
    const base = new Date('2026-10-27T15:00:00Z'); // 12h em São Paulo
    const rt = (ms: number) => releaseText(new Date(base.getTime() + ms), base);
    check(rt(2 * HOUR) === 'às 14h', 'daqui a 2 h => "às 14h"', rt(2 * HOUR));
    check(rt(2.5 * HOUR) === 'às 14h30', 'com minutos => "às 14h30"', rt(2.5 * HOUR));
    check(rt(18 * HOUR) === 'amanhã às 6h', 'outro dia, < 24 h => "amanhã às 6h"', rt(18 * HOUR));
    check(rt(12 * DAY - HOUR) === 'em 12 dias', '"em 12 dias"', rt(12 * DAY - HOUR));
    check(rt(DAY + HOUR) === 'em 2 dias', 'arredonda para cima (1 dia e 1 h => 2 dias)', rt(DAY + HOUR));

    const a = await register('a');

    console.log('\n— GET /quotas (plano gratuito, sem uso) —');
    let q = await call('/quotas', a.token);
    check(q.status === 200, 'GET /quotas => 200', q);
    const p0 = q.body?.photo_recognition;
    check(p0?.limit === 10 && p0.used === 0 && p0.remaining === 10 && p0.plan === 'free' && p0.resetsAt === null, 'fotos: 10 de 10 restantes, sem resetsAt', p0);
    check(q.body?.ai_workout_plan?.limit === 1 && q.body.ai_workout_plan.remaining === 1, 'plano de treino: 1 restante', q.body?.ai_workout_plan);
    check((await fetch(`${API}/quotas`)).status === 401, 'GET /quotas sem token => 401');

    console.log('\n— Janela deslizante (fotos, gratuito: 10 em 30 dias) —');
    await addUse(a.id, 'photo_recognition', 31 * DAY); // fora da janela
    let s = await getQuotaStatus(a.id, 'photo_recognition');
    check(s.used === 0, 'uso de 31 dias atrás não conta', s);
    await addUse(a.id, 'photo_recognition', 29.5 * DAY); // entra na janela, sai em 12 h
    await addUse(a.id, 'photo_recognition', HOUR, 9);
    s = await getQuotaStatus(a.id, 'photo_recognition');
    check(s.used === 10 && s.remaining === 0, '10 usos na janela => esgotada', s);
    const dt = new Date(s.resetsAt!).getTime() - Date.now();
    check(Math.abs(dt - 0.5 * DAY) < 60_000, 'resetsAt = uso mais antigo + 30 dias (daqui ~12 h)', { resetsAt: s.resetsAt, dtHours: dt / HOUR });

    const blocked = await call('/nutrition/recognize', a.token, 'POST', tinyImage);
    check(blocked.status === 429 && blocked.body?.error === 'quota_exceeded', 'cota esgotada => 429 quota_exceeded', blocked);
    check(typeof blocked.body?.resetsAt === 'string' && !Number.isNaN(Date.parse(blocked.body.resetsAt)), '429 traz resetsAt (ISO)', blocked.body);
    check(/10 fotos/.test(blocked.body?.message) && /libera (amanhã )?às \d+h/.test(blocked.body?.message), 'mensagem em PT-BR diz quando libera', blocked.body?.message);

    await pool.query(`UPDATE usage_quotas SET used_at = now() - interval '30 days 1 hour' WHERE user_id = $1 AND used_at < now() - interval '29 days' AND used_at > now() - interval '30 days'`, [a.id]);
    s = await getQuotaStatus(a.id, 'photo_recognition');
    check(s.used === 9 && s.remaining === 1, 'o uso mais antigo sai da janela e libera 1 vaga', s);

    console.log('\n— Falha da IA não consome cota —');
    const failed = await call('/nutrition/recognize', a.token, 'POST', tinyImage);
    check(failed.status === 503 && failed.body?.error === 'ai_unavailable', 'IA indisponível => 503', failed);
    s = await getQuotaStatus(a.id, 'photo_recognition');
    check(s.used === 9, 'após a falha da IA o uso continua 9', s);

    console.log('\n— consumeQuota —');
    await consumeQuota(a.id, 'photo_recognition', 'ref-1');
    s = await getQuotaStatus(a.id, 'photo_recognition');
    check(s.used === 10 && s.remaining === 0, 'consumir registra 1 uso', s);
    const row = await pool.query('SELECT ref_id FROM usage_quotas WHERE user_id = $1 AND ref_id IS NOT NULL', [a.id]);
    check(row.rows[0]?.ref_id === 'ref-1', 'ref_id gravado', row.rows);

    console.log('\n— Gratuito x pago —');
    await clear(a.id);
    await addUse(a.id, 'photo_recognition', 2 * DAY, 10); // 10 usos há 2 dias: dentro de 30 dias, fora de 24 h
    s = await getQuotaStatus(a.id, 'photo_recognition');
    check(s.plan === 'free' && s.remaining === 0, 'gratuito: 10 usos em 30 dias => esgotada', s);
    await pool.query(`INSERT INTO subscriptions (user_id, plan, status, expires_at) VALUES ($1, 'premium', 'canceled', NULL)`, [a.id]);
    check((await getQuotaStatus(a.id, 'photo_recognition')).plan === 'free', 'assinatura cancelada => gratuito');
    await pool.query(`UPDATE subscriptions SET status = 'active', expires_at = now() - interval '1 day' WHERE user_id = $1`, [a.id]);
    check((await getQuotaStatus(a.id, 'photo_recognition')).plan === 'free', 'assinatura vencida => gratuito');
    await pool.query(`UPDATE subscriptions SET expires_at = now() + interval '30 days' WHERE user_id = $1`, [a.id]);
    s = await getQuotaStatus(a.id, 'photo_recognition');
    check(s.plan === 'paid' && s.limit === 20 && s.used === 0 && s.remaining === 20, 'pago: 20 por 24 h, usos de 2 dias atrás não contam', s);
    await addUse(a.id, 'photo_recognition', HOUR, 20);
    const paidBlocked = await call('/nutrition/recognize', a.token, 'POST', tinyImage);
    check(paidBlocked.status === 429 && /20 fotos de hoje/.test(paidBlocked.body?.message), 'pago: 20 em 24 h => 429 ("fotos de hoje")', paidBlocked.body);

    console.log('\n— Plano de treino por IA (gratuito 1/90 dias, pago 1/7 dias) —');
    await clear(a.id);
    await pool.query('DELETE FROM subscriptions WHERE user_id = $1', [a.id]);
    await addUse(a.id, 'ai_workout_plan', 8 * DAY);
    s = await getQuotaStatus(a.id, 'ai_workout_plan');
    check(s.plan === 'free' && s.limit === 1 && s.remaining === 0, 'gratuito: uso há 8 dias ainda bloqueia (janela de 90 dias)', s);
    check(Math.abs(new Date(s.resetsAt!).getTime() - (Date.now() + 82 * DAY)) < 60_000, 'libera em ~82 dias', s.resetsAt);
    const planBlocked = await call('/onboarding/complete', a.token, 'POST');
    check(planBlocked.status === 429 && planBlocked.body?.error === 'quota_exceeded' && /libera em 8\d dias/.test(planBlocked.body?.message), 'POST /onboarding/complete => 429 "libera em N dias"', planBlocked.body);
    await pool.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'premium', 'active')`, [a.id]);
    s = await getQuotaStatus(a.id, 'ai_workout_plan');
    check(s.plan === 'paid' && s.remaining === 1, 'pago: uso há 8 dias já saiu da janela de 7 dias', s);
    await clear(a.id);
    await addUse(a.id, 'ai_workout_plan', 2 * DAY);
    s = await getQuotaStatus(a.id, 'ai_workout_plan');
    check(s.remaining === 0 && Math.abs(new Date(s.resetsAt!).getTime() - (Date.now() + 5 * DAY)) < 60_000, 'pago: uso há 2 dias => libera em ~5 dias', s);

    console.log('\n— Falha na geração não consome —');
    await clear(a.id);
    const incomplete = await call('/onboarding/complete', a.token, 'POST');
    check(incomplete.status === 400 && incomplete.body?.error === 'onboarding_incomplete', 'perfil incompleto => 400', incomplete);
    check((await getQuotaStatus(a.id, 'ai_workout_plan')).used === 0, 'após o erro nenhuma cota foi consumida');

    console.log('\n— Cotas são por usuário e por recurso —');
    const b = await register('b');
    await addUse(a.id, 'photo_recognition', HOUR, 20);
    q = await call('/quotas', b.token);
    check(q.body.photo_recognition.used === 0 && q.body.ai_workout_plan.used === 0, 'uso de outro usuário não afeta', q.body);
    q = await call('/quotas', a.token);
    check(q.body.ai_workout_plan.used === 0 && q.body.photo_recognition.used === 20, 'cotas de recursos diferentes são independentes', q.body);
  } finally {
    for (const email of emails) await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => undefined);
    await pool.end();
    server.kill();
    killPort(PORT);
  }
  console.log(failures === 0 ? '\nTodos os testes passaram.' : `\n${failures} falha(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
