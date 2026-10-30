/**
 * Teste da tela da dieta: plano ativo com prioridade (nutricionista > próprio > IA), um só plano próprio ativo,
 * edição do próprio plano pelo aluno e bloqueio para os demais.
 *
 *   npm run test:diet
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';
import { approveProfessional, registrationFor } from './test-helpers';

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
  const stamp = Date.now();
  const register = async (tag: string, role: 'student' | 'nutritionist') => {
    const email = `diet-${tag}-${stamp}@teste.local`;
    const r = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Teste Dieta', email, password: 'SenhaTeste123!', role, ...registrationFor(role) }),
    });
    const token = ((await r.json()) as { accessToken: string }).accessToken;
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    return { token, id: rows[0].id as string };
  };

  try {
    const a = await register('a', 'student');
    const b = await register('b', 'student');
    const { rows: foods } = await pool.query(
      "INSERT INTO foods (name, source, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g) VALUES ($1, 'custom', 'teste', 120, 3, 25, 1) RETURNING id",
      [`Dieta teste ${stamp}`],
    );
    const foodId = foods[0].id as string;
    const meal = (name: string, grams: number) => ({ name, foods: [{ foodId, quantityG: grams }] });

    console.log('— Sem plano —');
    let act = await call('/nutrition/plans/active', a.token);
    check(act.status === 200 && act.body.active === null && act.body.own === null, 'sem plano: active e own nulos', act.body);
    check((await call('/nutrition/plans/active', null)).status === 401, 'sem token => 401');

    console.log('\n— Plano próprio —');
    const first = await call('/nutrition/plans', a.token, 'POST', { title: 'Minha dieta', meals: [meal('Almoço', 150)] });
    check(first.status === 201 && first.body.source === 'self' && first.body.status === 'active', 'aluno cria plano próprio ativo', first.status);
    act = await call('/nutrition/plans/active', a.token);
    check(act.body.active?.id === first.body.id && act.body.own?.id === first.body.id, 'plano próprio aparece como ativo e como próprio');
    check(act.body.active.totals.kcal === 180, 'totais calculados (150 g × 120 kcal/100 g = 180)', act.body.active.totals);

    const second = await call('/nutrition/plans', a.token, 'POST', { title: 'Dieta nova', meals: [meal('Jantar', 100)] });
    check(second.status === 201, 'segundo plano próprio é criado');
    const old = await call(`/nutrition/plans/${first.body.id}`, a.token);
    check(old.body.status === 'archived', 'o anterior fica arquivado (só um plano próprio ativo)', old.body.status);
    act = await call('/nutrition/plans/active', a.token);
    check(act.body.own?.id === second.body.id, 'o próprio ativo é o novo');

    console.log('\n— Edição do próprio plano —');
    const upd = await call(`/nutrition/plans/${second.body.id}`, a.token, 'PUT', { title: 'Dieta editada', meals: [meal('Jantar', 100), meal('Lanche', 60)] });
    check(upd.status === 200 && upd.body.title === 'Dieta editada' && upd.body.meals.length === 2, 'aluno edita o próprio plano', upd.status);
    check((await call(`/nutrition/plans/${second.body.id}`, b.token, 'PUT', { title: 'Invasão', meals: [meal('Teste', 10)] })).status === 404, 'outro aluno não edita o plano => 404');
    check((await call(`/nutrition/plans/${old.body.id}`, a.token, 'PUT', { title: 'Arquivado', meals: [meal('Teste', 10)] })).status === 409, 'plano arquivado não edita => 409');

    console.log('\n— Prioridade: plano do nutricionista —');
    const n = await register('n', 'nutritionist');
    await approveProfessional(pool, n.id);
    await pool.query(
      `INSERT INTO nutritionist_patient (nutritionist_id, patient_id, status, consent_version) VALUES ($1, $2, 'active', 'teste')`,
      [n.id, a.id],
    );
    await pool.query(
      `INSERT INTO diet_plans (patient_id, prescribed_by, title, source, status, target_kcal) VALUES ($1, $2, 'Plano do nutricionista', 'nutritionist', 'active', 1800)`,
      [a.id, n.id],
    );
    act = await call('/nutrition/plans/active', a.token);
    check(act.body.active?.source === 'nutritionist', 'o plano do nutricionista vence o próprio, mesmo sendo mais antigo', act.body.active?.source);
    check(act.body.own?.id === second.body.id, 'o próprio plano continua disponível para edição');

    console.log('\n— Resumo do dia usa a mesma prioridade —');
    const day = await call(`/nutrition/logs?date=${new Date().toISOString().slice(0, 10)}`, a.token);
    check(day.status === 200 && day.body.targets?.kcal === 1800, 'meta do dia vem do plano do nutricionista (1800)', day.body?.targets);
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
