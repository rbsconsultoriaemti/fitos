/**
 * Teste do registro de água: POST/GET/DELETE /nutrition/water, idempotência da fila offline (clientId), meta pelo
 * perfil e isolamento entre usuários.
 *
 *   npm run test:water
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';

const PORT = 3995;
const API = `http://localhost:${PORT}`;

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
  const emails = [`water-a-${stamp}@teste.local`, `water-b-${stamp}@teste.local`];
  const register = async (email: string) => {
    const r = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Teste Agua', email, password: 'SenhaTeste123!', role: 'student' }) });
    return ((await r.json()) as { accessToken: string }).accessToken;
  };
  try {
    const [a, b] = [await register(emails[0]), await register(emails[1])];

    let t = await call('/nutrition/water/today', a);
    check(t.status === 200 && t.body.totalMl === 0 && t.body.goalMl === 2000 && t.body.percent === 0, 'dia vazio: total 0, meta padrão 2000 ml', t.body);

    const gole = await call('/nutrition/water', a, 'POST', { amountMl: 150 });
    const copo = await call('/nutrition/water', a, 'POST', { amount_ml: 250 }); // formato snake_case também vale
    const garrafa = await call('/nutrition/water', a, 'POST', { amountMl: 500 });
    check([gole, copo, garrafa].every((r) => r.status === 201), 'POST registra 150, 250 (amount_ml) e 500 ml', [gole.body, copo.body, garrafa.body]);

    t = await call('/nutrition/water/today', a);
    check(t.body.totalMl === 900 && t.body.percent === 45 && t.body.entries.length === 3, 'GET today: 900 ml = 45% de 2000, 3 registros', t.body);
    check(t.body.byHour.length >= 1 && t.body.byHour.reduce((s: number, h: { totalMl: number }) => s + h.totalMl, 0) === 900, 'total por hora soma 900 ml', t.body.byHour);

    // fila offline: mesmo clientId reenviado não duplica; loggedAt antigo cai no dia certo
    const q1 = await call('/nutrition/water', a, 'POST', { amountMl: 250, clientId: `fila-${stamp}-1` });
    const q2 = await call('/nutrition/water', a, 'POST', { amountMl: 250, clientId: `fila-${stamp}-1` });
    check(q1.status === 201 && q2.status === 200 && q1.body.id === q2.body.id, 'reenvio com o mesmo clientId devolve o mesmo registro (sem duplicar)', [q1.body, q2.body]);
    t = await call('/nutrition/water/today', a);
    check(t.body.totalMl === 1150, 'total = 1150 ml depois do reenvio', t.body.totalMl);
    const old = await call('/nutrition/water', a, 'POST', { amountMl: 300, loggedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    t = await call('/nutrition/water/today', a);
    check(old.status === 201 && t.body.totalMl === 1150, 'registro de 2 dias atrás não entra no total de hoje', t.body.totalMl);

    // validação
    check((await call('/nutrition/water', a, 'POST', { amountMl: 0 })).status === 400, 'amountMl 0 => 400');
    check((await call('/nutrition/water', a, 'POST', { amountMl: 5000 })).status === 400, 'amountMl 5000 => 400');
    check((await call('/nutrition/water', a, 'POST', {})).status === 400, 'sem quantidade => 400');
    check((await call('/nutrition/water', a, 'POST', { amountMl: 200, loggedAt: new Date(Date.now() + 3_600_000).toISOString() })).status === 400, 'loggedAt no futuro => 400');

    // isolamento e remoção
    check((await call(`/nutrition/water/${garrafa.body.id}`, b, 'DELETE')).status === 404, 'outro usuário não apaga o registro');
    check((await call(`/nutrition/water/${garrafa.body.id}`, a, 'DELETE')).status === 204, 'DELETE do próprio registro => 204');
    check((await call(`/nutrition/water/${garrafa.body.id}`, a, 'DELETE')).status === 404, 'apagar de novo => 404');
    t = await call('/nutrition/water/today', a);
    check(t.body.totalMl === 650, 'total = 650 ml depois de remover 500', t.body.totalMl);
    const tb = await call('/nutrition/water/today', b);
    check(tb.body.totalMl === 0, 'o outro usuário continua com 0');

    // meta pelo perfil: "mais de 2 L" => 2500
    const put = await call('/profile', a, 'PUT', { onboarding: { step: 6, answers: { water: 'gt2' } } });
    t = await call('/nutrition/water/today', a);
    check(put.status === 200 && t.body.goalMl === 2500, 'perfil "mais de 2 L" => meta 2500 ml', [put.status, t.body.goalMl]);
    await call('/profile', a, 'PUT', { onboarding: { step: 6, answers: { water: '1to2' } } });
    t = await call('/nutrition/water/today', a);
    check(t.body.goalMl === 2000, 'perfil "1 a 2 L" => meta 2000 ml', t.body.goalMl);
  } finally {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [emails]).catch(() => undefined);
    await pool.end();
    server.kill();
    killPort(PORT);
  }
  console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} VERIFICAÇÃO(ÕES) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().then(() => process.exit(), (err) => {
  console.error(err);
  killPort(PORT);
  process.exit(1);
});
