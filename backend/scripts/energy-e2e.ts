/**
 * Meta calórica do dia: base (TMB × 1,2) + gasto dos treinos registrados no dia; a meta fixa do plano da IA não vale
 * mais que o cálculo; meta manual e plano de nutricionista continuam prevalecendo.
 *
 *   npm run test:energy
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';

const PORT = 3992;
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
async function call(path: string, token: string | null, method = 'GET', body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
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
  const email = `energy-${Date.now()}@teste.local`;
  try {
    const reg = await call('/auth/register', null, 'POST', { name: 'Aluno Energia', email, password: 'SenhaTeste123!', role: 'student' });
    const token = reg.body.accessToken as string;
    const userId = reg.body.user.id as string;
    // 30 anos aprox., 80 kg, 180 cm, homem: TMB = 10×80 + 6,25×180 − 5×idade + 5
    const born = new Date();
    born.setFullYear(born.getFullYear() - 30);
    born.setMonth(born.getMonth() - 1);
    await call('/profile', token, 'PUT', { birthDate: born.toISOString().slice(0, 10), sex: 'male', heightCm: 180, weightKg: 80 });
    const day = async () => (await call('/nutrition/logs', token)).body;

    // plano alimentar gerado pela IA (meta fixa de 1800 kcal, como no onboarding)
    await pool.query(`INSERT INTO diet_plans (patient_id, title, source, status, target_kcal) VALUES ($1, 'Plano IA', 'ai', 'active', 1800)`, [userId]);

    console.log('— Dia sem treino —');
    let d = await day();
    const bmr = 10 * 80 + 6.25 * 180 - 5 * 30 + 5;
    const base = Math.round(bmr * 1.2);
    check(d.energy.baseKcal === base && d.energy.workoutKcal === 0 && d.energy.workoutDone === false && d.energy.targetKcal === base, 'sem treino: meta = base (TMB × 1,2), workoutDone=false', d.energy);
    check(d.targets.kcal === base && d.targets.kcalSource === 'dynamic', 'a meta fixa de 1800 do plano da IA não prevalece sobre o cálculo', d.targets);

    console.log('— Com treino registrado —');
    const exercises = (await call('/workout/exercises', token)).body as { id: string; category: string }[];
    const strength = exercises.filter((e) => e.category !== 'cardio').slice(0, 2);
    const plan = await call('/workout/plans', token, 'POST', {
      title: 'Plano teste',
      days: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, muscleGroup: 'Peito', sets: strength.map((e) => ({ exerciseId: e.id, sets: 5, reps: '10' })) })),
    });
    const dayOfToday = plan.body.days.find((x: { dayOfWeek: number }) => x.dayOfWeek === (new Date().getDay() || 7));
    const log = await call('/workout/logs', token, 'POST', {
      planId: plan.body.id,
      dayId: dayOfToday.id,
      sets: dayOfToday.sets.map((s: { id: string }) => ({ setId: s.id, setsDone: 5 })),
    });
    check(log.status === 201, 'treino do dia registrado (10 séries)', log.body);
    d = await day();
    const workout = Math.round(6 * 80 * ((10 * 2.5) / 60)); // MET 6 × 80 kg × 25 min = 200 kcal
    check(d.energy.workoutKcal === workout && d.energy.workoutDone === true, `kcal do treino = séries × 2,5 min × MET 6 × peso = ${workout}`, d.energy);
    check(d.energy.targetKcal === base + workout && d.targets.kcal === base + workout && d.targets.kcalSource === 'dynamic', 'com treino: meta = base + treino', { energy: d.energy, targets: d.targets });

    console.log('— Precedências —');
    await pool.query(`UPDATE diet_plans SET source = 'nutritionist' WHERE patient_id = $1`, [userId]);
    d = await day();
    check(d.targets.kcal === 1800 && d.targets.kcalSource === 'plan', 'plano de nutricionista continua com prioridade', d.targets);
    await pool.query(`UPDATE diet_plans SET status = 'archived' WHERE patient_id = $1`, [userId]);
    await call('/nutrition/energy-target', token, 'PUT', { overrideKcal: 2222 });
    d = await day();
    check(d.targets.kcal === 2222 && d.targets.kcalSource === 'override' && d.energy.targetKcal === base + workout, 'meta manual prevalece; o cálculo continua disponível', d.targets);
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => undefined);
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
