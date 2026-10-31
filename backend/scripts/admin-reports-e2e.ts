/**
 * Portal > Métricas e assinaturas (/portal/admin/metrics, /portal/admin/subscriptions): só administrador da plataforma;
 * contagens batem com o banco; o plano efetivo segue a mesma regra das cotas.
 *
 *   npm run test:admin-reports
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';

const PORT = 3998;
const API = `http://localhost:${PORT}`;
const PASSWORD = 'SenhaTeste123!';
const PORTAL = { 'X-Fitos-Portal': '1' };

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

async function call(path: string, opts: { token?: string | null; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const r = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}

async function main() {
  const server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT) }, shell: true });
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

  const register = async (tag: string) => {
    const email = `rep-${tag}-${stamp}@teste.local`;
    const r = await call('/auth/register', { method: 'POST', body: { name: `Rep ${tag} ${stamp}`, email, password: PASSWORD, role: 'student' } });
    const id = r.body.user.id as string;
    return { email, id, token: async () => (await call('/portal/login', { method: 'POST', body: { email, password: PASSWORD }, headers: PORTAL })).body.accessToken as string };
  };

  try {
    const admin = await register('admin');
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [admin.id]);
    const premium = await register('premium');
    const free = await register('free');
    const tokAdmin = await admin.token();
    const tokFree = await free.token();

    console.log('— Sem permissão —');
    check((await call('/portal/admin/metrics', { token: tokFree })).status === 403, 'aluno vê métricas => 403');
    check((await call('/portal/admin/subscriptions', { token: tokFree })).status === 403, 'aluno vê assinaturas => 403');
    check((await call('/portal/admin/metrics')).status === 401, 'sem token => 401');

    console.log('\n— Métricas —');
    let m = await call('/portal/admin/metrics?days=7', { token: tokAdmin });
    check(m.status === 200, 'admin lê métricas', m.body);
    const keys = ['users', 'activity', 'usage', 'subscriptions', 'aiCost'];
    check(keys.every((k) => k in m.body), 'resposta tem as seções', Object.keys(m.body));
    check(m.body.windowDays === 7, 'janela de 7 dias');
    check((await call('/portal/admin/metrics?days=0', { token: tokAdmin })).status === 400, 'days=0 => 400');
    check((await call('/portal/admin/metrics?days=400', { token: tokAdmin })).status === 400, 'days=400 => 400');

    const before = m.body;
    await pool.query("INSERT INTO usage_quotas (user_id, kind) VALUES ($1, 'photo_recognition'), ($1, 'ai_workout_plan')", [free.id]);
    m = await call('/portal/admin/metrics?days=7', { token: tokAdmin });
    check(m.body.usage.photoRecognitions === before.usage.photoRecognitions + 1, 'foto conta +1 nas métricas', m.body.usage);
    check(m.body.usage.workoutPlansByAi === before.usage.workoutPlansByAi + 1, 'plano por IA conta +1');
    const esperado = Math.round((m.body.usage.photoRecognitions + m.body.usage.workoutPlansByAi) * m.body.aiCost.costPerCallBrl * 100) / 100;
    check(m.body.aiCost.estimatedBrl === esperado, 'custo estimado = chamadas × custo por chamada', m.body.aiCost);
    check(m.body.activity.activeInWindow >= 2, 'contas com sessão recente aparecem como ativas', m.body.activity);
    check(!/password|hash|token/i.test(m.body.generatedAt + JSON.stringify(m.body)), 'métricas não expõem dados sensíveis');

    console.log('\n— Assinaturas e cotas —');
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan, status, expires_at, store, environment, auto_renew)
       VALUES ($1, 'premium', 'active', now() + interval '30 days', 'APP_STORE', 'SANDBOX', true)`,
      [premium.id],
    );
    let s = await call(`/portal/admin/subscriptions?q=${encodeURIComponent(`rep-premium-${stamp}`)}`, { token: tokAdmin });
    check(s.status === 200 && s.body.items.length === 1, 'busca a conta premium', s.body);
    const p = s.body.items[0];
    check(p.subscription?.plan === 'premium' && p.subscription?.status === 'active', 'mostra a assinatura', p.subscription);
    check(p.effectivePlan === 'paid' && p.quotas.photoRecognition.limit === 20, 'premium ativo: cota paga (20 fotos/dia)', p.quotas);

    s = await call(`/portal/admin/subscriptions?q=${encodeURIComponent(`rep-free-${stamp}`)}`, { token: tokAdmin });
    const f = s.body.items[0];
    check(f.subscription === null && f.effectivePlan === 'free', 'sem assinatura: plano gratuito', f);
    check(f.quotas.photoRecognition.limit === 10 && f.quotas.photoRecognition.used === 1, 'gratuito: 10 fotos nos 30 dias (1 usada no teste)', f.quotas);
    check(f.quotas.workoutPlan.limit === 1 && f.quotas.workoutPlan.used === 1, 'plano por IA usado aparece na cota', f.quotas);

    await pool.query("UPDATE subscriptions SET expires_at = now() - interval '1 day' WHERE user_id = $1", [premium.id]);
    s = await call(`/portal/admin/subscriptions?q=${encodeURIComponent(`rep-premium-${stamp}`)}`, { token: tokAdmin });
    check(s.body.items[0].effectivePlan === 'free', 'assinatura vencida volta ao plano gratuito', s.body.items[0]);

    const itemKeys = Object.keys(s.body.items[0]).sort().join(',');
    check(!/password|hash|token/i.test(s.text ?? JSON.stringify(s.body)), 'assinaturas não expõem dados sensíveis', itemKeys);
    check(s.body.pageSize === 50 && typeof s.body.total === 'number', 'paginação de 50');
  } finally {
    server.kill();
    killPort(PORT);
    await pool.end();
  }

  console.log(failures === 0 ? '\nTudo certo.' : `\n${failures} falha(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
