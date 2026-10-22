/**
 * Fila offline da água, usando a MESMA lógica do app (mobile/src/lib/water.ts) contra o backend de verdade:
 * registra online, derruba o servidor, registra offline (total local + fila), desfaz, religa e confere que a fila
 * sobe sem duplicar e que o total do servidor bate.
 *
 *   npm run test:water-offline
 */
import 'dotenv/config';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { Pool } from 'pg';

const PORT = 3994;
process.env.EXPO_PUBLIC_API_URL = `http://localhost:${PORT}`;

let failures = 0;
const check = (ok: boolean, what: string, extra?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${what}${!ok && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
};
const killPort = (port: number) => {
  try {
    execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`, { stdio: 'ignore' });
  } catch {
    /* nada a encerrar */
  }
};
let server: ChildProcess | null = null;
async function start() {
  server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT) }, shell: true });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/health`)).ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('backend não subiu');
}
const stop = () => {
  server?.kill();
  killPort(PORT);
  server = null;
};

async function main() {
  const water = await import('../../mobile/src/lib/water');
  const { saveTokens } = await import('../../mobile/src/lib/api');
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  // Lembretes de água (lógica pura, sem servidor): 'agora' = hoje 14:10
  const { planWaterReminders } = await import('../../mobile/src/lib/notifications');
  const now = new Date();
  now.setHours(14, 10, 0, 0);
  const hoursToday = (list: { when: Date }[]) => list.filter((r) => r.when.getDate() === now.getDate()).map((r) => r.when.getHours());
  let plan = planWaterReminders(300, 2000, now);
  check(hoursToday(plan).join() === '16,18,20', 'lembretes de hoje às 14:10: só os horários que faltam (16, 18, 20)', hoursToday(plan));
  check(plan.find((r) => r.when.getHours() === 16 && r.when.getDate() === now.getDate())?.urgent === true, 'às 16h com 15% da meta: aviso urgente');
  check(plan.filter((r) => r.urgent).length === 1, 'só o das 16h de hoje é urgente');
  plan = planWaterReminders(1000, 2000, now);
  check(plan.find((r) => r.when.getHours() === 16 && r.when.getDate() === now.getDate())?.urgent === false, 'com 50% da meta o das 16h é normal (não urgente)');
  plan = planWaterReminders(1700, 2000, now);
  check(hoursToday(plan).length === 0, 'com 85% da meta: nenhum aviso hoje', hoursToday(plan));
  check(plan.length === 14, 'mas os próximos 2 dias seguem com os 7 horários normais (14 avisos)', plan.length);
  check(planWaterReminders(1600, 2000, now).length === 14, 'exatamente 80% já silencia hoje');
  check(hoursToday(planWaterReminders(1599, 2000, now)).length === 3, '79% ainda avisa hoje');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const email = `water-off-${Date.now()}@teste.local`;
  try {
    await start();
    const r = await fetch(`http://localhost:${PORT}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Teste Fila', email, password: 'SenhaTeste123!', role: 'student' }) });
    await saveTokens((await r.json()) as { accessToken: string; refreshToken: string });
    const serverTotal = async () => {
      const { rows } = await pool.query("SELECT COALESCE(sum(w.amount_ml),0)::int AS t, count(*)::int AS n FROM water_logs w JOIN users u ON u.id = w.user_id WHERE u.email = $1", [email]);
      return rows[0] as { t: number; n: number };
    };

    let s = await water.addWater(250);
    check(s.totalMl === 250 && s.pending === 0 && !s.offline && s.goalMl === 2000, 'online: +250 ml sobe direto (total 250, fila vazia, meta 2000)', s);
    check((await serverTotal()).t === 250, 'servidor tem 250 ml');

    stop();
    await new Promise((r) => setTimeout(r, 1500));
    s = await water.addWater(500);
    check(s.totalMl === 750 && s.pending === 1 && s.offline, 'offline: +500 ml => total local 750, 1 na fila', s);
    s = await water.addWater(150);
    check(s.totalMl === 900 && s.pending === 2, 'offline: +150 ml => total local 900, 2 na fila', s);
    s = await water.undoLastWater();
    check(s.totalMl === 750 && s.pending === 1, 'offline: desfazer tira o último da fila (total 750)', s);
    const local = await water.readWaterLocal();
    check(local.totalMl === 750 && local.percent === 38, 'leitura local (usada pelas notificações): 750 ml = 38%', local);

    // virada do dia: cache de ontem não conta para hoje; só a fila de hoje
    const cache = JSON.parse((await AsyncStorage.getItem('fitos.water.cache'))!);
    await AsyncStorage.setItem('fitos.water.cache', JSON.stringify({ ...cache, date: '2000-01-01' }));
    const next = await water.readWaterLocal();
    check(next.totalMl === 500, 'dia novo: o total do cache antigo é descartado (só os 500 ml da fila)', next);
    await AsyncStorage.setItem('fitos.water.cache', JSON.stringify(cache));

    await start();
    s = await water.loadWater();
    const db = await serverTotal();
    check(s.pending === 0 && !s.offline && s.totalMl === 750, 'internet voltou: fila enviada, total 750', s);
    check(db.t === 750 && db.n === 2, 'servidor: 750 ml em 2 registros (250 + 500), sem duplicar', db);

    s = await water.loadWater();
    check((await serverTotal()).n === 2, 'carregar de novo não duplica');
    s = await water.undoLastWater();
    check(s.totalMl === 250 && (await serverTotal()).t === 250, 'desfazer um registro já enviado apaga no servidor (total 250)', s);
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => undefined);
    await pool.end();
    stop();
  }
  console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} VERIFICAÇÃO(ÕES) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().then(() => process.exit(), (err) => {
  console.error(err);
  stop();
  process.exit(1);
});
