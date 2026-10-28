/**
 * Bloqueio de prescrição para profissional não validado + cadastro público de profissional (pendente, com registro).
 *
 *   npm run test:professional-gate
 *
 * Altera dados: só roda no banco local (ver scripts/local-only.ts).
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';
import { assertLocalOnly } from './local-only';

const PORT = 3993;
const API = `http://localhost:${PORT}`;
const PASSWORD = 'SenhaTeste123!';
const PORTAL = { 'X-Fitos-Portal': '1' };
const UUID = '00000000-0000-4000-8000-000000000000';

let failures = 0;
const check = (ok: boolean, what: string, extra?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${what}${!ok && extra !== undefined ? ` → ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
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
  return { status: r.status, text, body: text ? JSON.parse(text) : null };
}

interface Route {
  label: string;
  method: string;
  path: string;
  role: 'trainer' | 'nutritionist' | 'running_coach';
  body?: unknown;
}

// Rotas só de profissional (requireValidatedProfessional) e compartilhadas com o aluno (requireValidatedIfProfessional).
const PRO_ONLY: Route[] = [
  { label: 'GET /trainer/students', method: 'GET', path: '/trainer/students', role: 'trainer' },
  { label: 'GET /trainer/students/:id', method: 'GET', path: `/trainer/students/${UUID}`, role: 'trainer' },
  { label: 'POST /trainer/students/:id/suggest-plan', method: 'POST', path: `/trainer/students/${UUID}/suggest-plan`, role: 'trainer' },
  { label: 'POST /workout/exercises', method: 'POST', path: '/workout/exercises', role: 'trainer', body: {} },
  { label: 'POST /workout/plans/:id/approve', method: 'POST', path: `/workout/plans/${UUID}/approve`, role: 'trainer' },
  { label: 'POST /workout/plans/:id/approve (running_coach)', method: 'POST', path: `/workout/plans/${UUID}/approve`, role: 'running_coach' },
  { label: 'POST /nutrition/foods', method: 'POST', path: '/nutrition/foods', role: 'nutritionist', body: {} },
  { label: 'PATCH /nutrition/foods/:id/portions', method: 'PATCH', path: `/nutrition/foods/${UUID}/portions`, role: 'nutritionist', body: {} },
  { label: 'POST /nutrition/plans/:id/approve', method: 'POST', path: `/nutrition/plans/${UUID}/approve`, role: 'nutritionist' },
  { label: 'POST /invites/generate', method: 'POST', path: '/invites/generate', role: 'trainer' },
  { label: 'POST /invites/generate (running_coach)', method: 'POST', path: '/invites/generate', role: 'running_coach' },
];
const SHARED: Route[] = [
  { label: 'POST /workout/plans', method: 'POST', path: '/workout/plans', role: 'trainer', body: {} },
  { label: 'PUT /workout/plans/:id', method: 'PUT', path: `/workout/plans/${UUID}`, role: 'trainer', body: {} },
  { label: 'POST /workout/plans/:id/archive', method: 'POST', path: `/workout/plans/${UUID}/archive`, role: 'trainer' },
  { label: 'POST /workout/plans (running_coach)', method: 'POST', path: '/workout/plans', role: 'running_coach', body: {} },
  { label: 'POST /nutrition/plans', method: 'POST', path: '/nutrition/plans', role: 'nutritionist', body: {} },
  { label: 'PUT /nutrition/plans/:id', method: 'PUT', path: `/nutrition/plans/${UUID}`, role: 'nutritionist', body: {} },
  { label: 'POST /nutrition/plans/:id/archive', method: 'POST', path: `/nutrition/plans/${UUID}/archive`, role: 'nutritionist' },
];
const STUDENT_SHARED: Omit<Route, 'role'>[] = [
  { label: 'POST /workout/plans', method: 'POST', path: '/workout/plans', body: {} },
  { label: 'PUT /workout/plans/:id', method: 'PUT', path: `/workout/plans/${UUID}`, body: {} },
  { label: 'POST /workout/plans/:id/archive', method: 'POST', path: `/workout/plans/${UUID}/archive` },
  { label: 'POST /nutrition/plans', method: 'POST', path: '/nutrition/plans', body: {} },
  { label: 'PUT /nutrition/plans/:id', method: 'PUT', path: `/nutrition/plans/${UUID}`, body: {} },
  { label: 'POST /nutrition/plans/:id/archive', method: 'POST', path: `/nutrition/plans/${UUID}/archive` },
];

async function main() {
  assertLocalOnly('test:professional-gate');
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
  const tag = `gate-${stamp}`;
  const REG: Record<string, Record<string, string>> = {
    trainer: { registrationState: 'SP', registrationCouncil: 'CREF', registrationNumber: '012345-G/SP' },
    nutritionist: { registrationState: 'SP', registrationCouncil: 'CRN', registrationNumber: '98765' },
    psychologist: { registrationState: 'SP', registrationCouncil: 'CRP', registrationNumber: '06/12345' },
    running_coach: { registrationState: 'SP', registrationCouncil: 'SEM_CONSELHO' },
    cycling_coach: { registrationState: 'SP', registrationCouncil: 'CREF', registrationNumber: '777' },
  };
  const register = async (name: string, role: string, withRegistration = true) => {
    const email = `${tag}-${name}@teste.local`;
    const r = await call('/auth/register', { method: 'POST', body: { name: `Gate ${name}`, email, password: PASSWORD, role, ...(withRegistration ? (REG[role] ?? {}) : {}) } });
    return { email, r, id: r.body?.user?.id as string, token: r.body?.accessToken as string };
  };

  try {
    console.log('— Cadastro público —');
    for (const role of Object.keys(REG)) {
      const r = await register(`semreg-${role}`, role, false);
      check(r.r.status === 400 && r.r.body.error === 'registration_required', `${role} sem registro => 400`, r.r.body);
    }
    let r = await call('/auth/register', { method: 'POST', body: { name: 'Gate x', email: `${tag}-x@teste.local`, password: PASSWORD, role: 'nutritionist', registrationState: 'SP', registrationCouncil: 'CREF', registrationNumber: '12345' } });
    check(r.status === 400 && r.body.error === 'registration_council_invalid', 'nutricionista com CREF => 400', r.body);
    r = await call('/auth/register', { method: 'POST', body: { name: 'Gate x', email: `${tag}-x@teste.local`, password: PASSWORD, role: 'trainer', registrationState: 'SP', registrationCouncil: 'CREF' } });
    check(r.status === 400, 'CREF sem número => 400');
    r = await call('/auth/register', { method: 'POST', body: { name: 'Gate z', email: `${tag}-z@teste.local`, password: PASSWORD, role: 'trainer', registrationCouncil: 'CREF', registrationNumber: '012345' } });
    check(r.status === 400 && r.body.error === 'registration_state_required', 'sem UF => 400 (registration_state_required)', r.body);
    r = await call('/auth/register', { method: 'POST', body: { name: 'Gate x', email: `${tag}-x@teste.local`, password: PASSWORD, role: 'trainer', registrationState: 'SP', registrationCouncil: 'CREF', registrationNumber: 'a b' } });
    check(r.status === 400, 'número inválido => 400');
    check(Number((await pool.query('SELECT count(*) n FROM users WHERE email = $1', [`${tag}-x@teste.local`])).rows[0].n) === 0, 'cadastros recusados não criam conta');
    check((await call('/auth/register', { method: 'POST', body: { name: 'Gate y', email: `${tag}-y@teste.local`, password: PASSWORD, role: 'admin', registrationState: 'SP', registrationCouncil: 'CREF', registrationNumber: '1' } })).status === 400, 'role admin continua recusado no cadastro => 400');

    const pendTrainer = await register('pend-trainer', 'trainer');
    const pendNutri = await register('pend-nutri', 'nutritionist');
    const pendRun = await register('pend-run', 'running_coach');
    check([pendTrainer, pendNutri, pendRun].every((x) => x.r.status === 201 && x.r.body.user.validationStatus === 'pending' && !!x.token), 'profissional se cadastra (201), recebe tokens e nasce pending', pendTrainer.r.body);
    const row = (await pool.query('SELECT validation_status, registration_council, registration_number, validated_by FROM users WHERE id = $1', [pendTrainer.id])).rows[0];
    check(row.validation_status === 'pending' && row.registration_council === 'CREF' && row.registration_number === '012345-G/SP' && row.validated_by === null, 'banco: pending, CREF e número gravados, ninguém validou', row);
    const runRow = (await pool.query('SELECT registration_council, registration_number FROM users WHERE id = $1', [pendRun.id])).rows[0];
    check(runRow.registration_council === 'SEM_CONSELHO' && runRow.registration_number === null, 'treinador de corrida sem conselho aceito (número nulo)');
    const psy = await register('pend-psi', 'psychologist');
    const cyc = await register('pend-cic', 'cycling_coach');
    check(psy.r.status === 201 && cyc.r.status === 201, 'psicólogo (CRP) e treinador de ciclismo (CREF) se cadastram');

    const student = await register('aluno', 'student', false);
    check(student.r.status === 201 && student.r.body.user.validationStatus === 'approved', 'aluno continua se cadastrando como antes (approved)');
    const studentWithReg = await call('/auth/register', { method: 'POST', body: { name: 'Gate aluno2', email: `${tag}-aluno2@teste.local`, password: PASSWORD, registrationState: 'SP', registrationCouncil: 'CRN', registrationNumber: '123' } });
    const sRow = (await pool.query('SELECT role, validation_status, registration_council FROM users WHERE id = $1', [studentWithReg.body.user.id])).rows[0];
    check(studentWithReg.status === 201 && sRow.role === 'student' && sRow.validation_status === 'approved' && sRow.registration_council === null, 'aluno que manda registro: campos ignorados, nada gravado', sRow);
    check((await call('/auth/login', { method: 'POST', body: { email: pendTrainer.email, password: PASSWORD } })).status === 200, 'profissional pendente consegue entrar (login)');

    // Contas para os cenários
    const admin = await register('admin', 'student', false);
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [admin.id]);
    const adminTok = (await call('/portal/login', { method: 'POST', body: { email: admin.email, password: PASSWORD }, headers: PORTAL })).body.accessToken as string;
    const decide = (id: string, act: 'validate' | 'reject') => call(`/portal/admin/professionals/${id}/${act}`, { method: 'POST', token: adminTok, headers: PORTAL });

    const okTrainer = await register('ok-trainer', 'trainer');
    const okNutri = await register('ok-nutri', 'nutritionist');
    const okRun = await register('ok-run', 'running_coach');
    const rejTrainer = await register('rej-trainer', 'trainer');
    const rejNutri = await register('rej-nutri', 'nutritionist');
    for (const x of [okTrainer, okNutri, okRun]) check((await decide(x.id, 'validate')).status === 200, 'administrador valida (via API)');
    for (const x of [rejTrainer, rejNutri]) check((await decide(x.id, 'reject')).status === 200, 'administrador rejeita (via API)');
    const byRole = (a: { trainer: string; nutritionist: string; running_coach: string }, role: Route['role']) => a[role];

    const tokens = {
      pending: { trainer: pendTrainer.token, nutritionist: pendNutri.token, running_coach: pendRun.token },
      rejected: { trainer: rejTrainer.token, nutritionist: rejNutri.token, running_coach: rejTrainer.token },
      approved: { trainer: okTrainer.token, nutritionist: okNutri.token, running_coach: okRun.token },
    };

    console.log('\n— Pendente e rejeitado recebem 403 professional_not_validated —');
    for (const state of ['pending', 'rejected'] as const) {
      for (const rt of [...PRO_ONLY, ...SHARED]) {
        if (state === 'rejected' && rt.role === 'running_coach') continue; // sem conta de corrida rejeitada
        const x = await call(rt.path, { method: rt.method, token: byRole(tokens[state], rt.role), body: rt.body, headers: PORTAL });
        check(x.status === 403 && x.body.error === 'professional_not_validated', `${state}: ${rt.label} => 403 professional_not_validated`, { status: x.status, body: x.body });
      }
    }

    console.log('\n— Aprovado passa pelo guard —');
    for (const rt of [...PRO_ONLY, ...SHARED]) {
      const x = await call(rt.path, { method: rt.method, token: byRole(tokens.approved, rt.role), body: rt.body, headers: PORTAL });
      check(x.status !== 403 && x.status !== 401 && x.status < 500, `approved: ${rt.label} => ${x.status} (não barrado)`, x.body);
    }

    console.log('\n— O estado é lido do banco a cada requisição —');
    await pool.query("UPDATE users SET validation_status = 'approved' WHERE id = $1", [pendTrainer.id]);
    let x = await call('/trainer/students', { token: pendTrainer.token });
    check(x.status === 200, 'aprovado no banco: o MESMO token passa na hora');
    await pool.query("UPDATE users SET validation_status = 'rejected' WHERE id = $1", [pendTrainer.id]);
    x = await call('/trainer/students', { token: pendTrainer.token });
    check(x.status === 403 && x.body.error === 'professional_not_validated', 'rejeitado no banco: o mesmo token é barrado na próxima requisição');
    await pool.query("UPDATE users SET validation_status = 'pending' WHERE id = $1", [pendTrainer.id]);

    console.log('\n— Aluno nunca é barrado —');
    const exId = (await call('/workout/exercises', { token: student.token })).body[0]?.id as string;
    const sets = [{ exerciseId: exId, sets: 3, reps: '10', restSeconds: 60 }];
    x = await call('/workout/plans', { method: 'POST', token: student.token, body: { title: 'Meu plano', days: [{ dayOfWeek: 1, muscleGroup: 'Peito', sets }] } });
    check(x.status === 201, 'aluno cria o próprio plano de treino (201)', x.body);
    const planId = x.body.id as string;
    x = await call(`/workout/plans/${planId}`, { method: 'PUT', token: student.token, body: { title: 'Meu plano 2', days: [{ dayOfWeek: 2, muscleGroup: 'Costas', sets }] } });
    check(x.status === 200, 'aluno edita o próprio plano (200)', x.body);
    x = await call(`/workout/plans/${planId}/archive`, { method: 'POST', token: student.token, headers: PORTAL });
    check(x.status === 200, 'aluno arquiva o próprio plano (200)', x.body);
    for (const rt of STUDENT_SHARED) {
      x = await call(rt.path, { method: rt.method, token: student.token, body: rt.body, headers: PORTAL });
      check(x.status !== 403 && x.status !== 401 && x.status < 500 && x.body?.error !== 'professional_not_validated', `aluno: ${rt.label} => ${x.status} (não barrado)`, x.body);
    }
    for (const path of ['/workout/plans', '/workout/exercises', '/workout/logs', '/nutrition/plans', '/quotas', '/profile', '/preferences/foods']) {
      x = await call(path, { token: student.token });
      check(x.status === 200, `aluno: GET ${path} => 200`, x.status);
    }
    x = await call('/invites/generate', { method: 'POST', token: student.token });
    check(x.status === 403 && x.body.error === 'forbidden', 'aluno em rota só de profissional continua com o 403 de sempre (forbidden, não professional_not_validated)', x.body);

    console.log('\n— Administrador e papel legado admin —');
    x = await call('/workout/plans', { method: 'POST', token: adminTok, body: {} });
    check(x.status === 400, 'administrador da plataforma passa o guard das rotas compartilhadas (400 de validação)', x.body);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [student.id]);
    const legacy = (await call('/auth/login', { method: 'POST', body: { email: student.email, password: PASSWORD } })).body.accessToken as string;
    x = await call('/workout/exercises', { method: 'POST', token: legacy, body: {} });
    check(x.status === 400, 'papel legado "admin" continua passando em POST /workout/exercises (comportamento anterior)', x.body);
    x = await call('/nutrition/foods', { method: 'POST', token: legacy, body: {} });
    check(x.status === 400, 'e em POST /nutrition/foods');
    await pool.query("UPDATE users SET role = 'student' WHERE id = $1", [student.id]);
  } finally {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`${tag}-%@teste.local`]).catch(() => undefined);
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
