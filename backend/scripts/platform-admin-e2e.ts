/**
 * Marcador de administrador da plataforma (users.is_platform_admin): separado do papel de negócio, só muda pelo
 * script grant-platform-admin, conferido no banco a cada requisição.
 *
 *   npm run test:platform-admin
 */
import 'dotenv/config';
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import type { Request, Response } from 'express';
import { requirePlatformAdmin, requirePortalAccess, requireProfessional } from '../src/modules/portal/portal.access';

const PORT = 3995;
const API = `http://localhost:${PORT}`;
const PASSWORD = 'SenhaTeste123!';
const LOG = path.join(os.tmpdir(), `platform-admin-test-${Date.now()}.log`);

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

async function call(p: string, opts: { token?: string | null; method?: string; body?: unknown } = {}) {
  const r = await fetch(`${API}${p}`, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

/** Roda o script real (como o dono faria na VPS). */
function grant(args: string[]) {
  const r = spawnSync('npx', ['tsx', 'scripts/grant-platform-admin.ts', ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))], {
    cwd: process.cwd(),
    env: { ...process.env, PLATFORM_ADMIN_LOG: LOG },
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Executa um middleware de verdade, com uma conta real do banco, e devolve o status de erro ou 'ok'. */
function runGuard(guard: (req: Request, res: Response, next: (e?: unknown) => void) => unknown, userId: string, jwtRole: string) {
  return new Promise<number | 'ok'>((resolve) => {
    const req = { auth: { sub: userId, role: jwtRole } } as unknown as Request;
    void guard(req, {} as Response, (e?: unknown) => resolve(e ? ((e as { status?: number }).status ?? 500) : 'ok'));
  });
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
  const emails: string[] = [];
  const flagOf = async (id: string) => (await pool.query('SELECT is_platform_admin AS f FROM users WHERE id = $1', [id])).rows[0].f as boolean;
  const register = async (tag: string, role = 'student', extra: Record<string, unknown> = {}) => {
    const email = `padm-${tag}-${stamp}@teste.local`;
    emails.push(email);
    const r = await call('/auth/register', { method: 'POST', body: { name: `Teste ${tag}`, email, password: PASSWORD, role, ...extra } });
    return { email, id: r.body.user.id as string, token: r.body.accessToken as string, status: r.status };
  };

  try {
    console.log('— Cadastro e corpos de requisição não aceitam o marcador —');
    const sneaky = await register('sneaky', 'student', { is_platform_admin: true, isPlatformAdmin: true });
    check(sneaky.status === 201 && (await flagOf(sneaky.id)) === false, 'POST /auth/register com is_platform_admin não altera nada');
    const student = await register('aluno');
    const trainer = await register('trainer', 'trainer');
    check((await flagOf(student.id)) === false && (await flagOf(trainer.id)) === false, 'contas novas nascem sem o marcador');
    const put = await call('/profile', { method: 'PUT', token: student.token, body: { name: 'Aluno Editado', is_platform_admin: true, isPlatformAdmin: true } });
    check(put.status === 200 && (await flagOf(student.id)) === false, 'PUT /profile com is_platform_admin não altera nada', put);
    await call('/invites/generate', { method: 'POST', token: trainer.token, body: { is_platform_admin: true } });
    await call('/invites/accept', { method: 'POST', token: student.token, body: { token: 'inexistente', is_platform_admin: true } });
    check((await flagOf(student.id)) === false && (await flagOf(trainer.id)) === false, 'corpo de convite com is_platform_admin não altera nada');

    console.log('\n— Middlewares (conta lida do banco) —');
    check((await runGuard(requirePlatformAdmin, student.id, 'student')) === 403, 'aluno comum não passa em requirePlatformAdmin');
    check((await runGuard(requirePortalAccess, student.id, 'student')) === 'ok', 'aluno comum passa em requirePortalAccess (conta ativa)');
    check((await runGuard(requireProfessional, student.id, 'student')) === 403, 'aluno comum não passa em requireProfessional');
    check((await runGuard(requireProfessional, trainer.id, 'trainer')) === 'ok', 'trainer passa em requireProfessional');
    check((await runGuard(requirePlatformAdmin, trainer.id, 'trainer')) === 403, 'trainer sem marcador não passa em requirePlatformAdmin');
    check((await runGuard(requirePlatformAdmin, '00000000-0000-4000-8000-000000000000', 'admin')) === 401, 'usuário inexistente => 401');
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [sneaky.id]);
    check((await runGuard(requirePlatformAdmin, sneaky.id, 'admin')) === 403, 'papel de negócio "admin" NÃO equivale ao marcador');
    check((await runGuard(requireProfessional, sneaky.id, 'admin')) === 403, 'papel "admin" sozinho não passa em requireProfessional');
    await pool.query("UPDATE users SET role = 'student' WHERE id = $1", [sneaky.id]);

    console.log('\n— Script grant-platform-admin —');
    let r = grant([]);
    check(r.code !== 0 && /--email/.test(r.out), 'sem --email: recusa', r);
    r = grant(['--email', 'sem-arroba']);
    check(r.code !== 0 && /inválido/.test(r.out), 'e-mail sem @: recusa');
    r = grant(['--email', 'tem espaco@x.com']);
    check(r.code !== 0 && /inválido/.test(r.out), 'e-mail com espaço: recusa');
    const before = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    r = grant(['--email', `nao-existe-${stamp}@teste.local`]);
    const same = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    check(r.code !== 0 && /nenhum usuário/.test(r.out) && same === before, 'e-mail inexistente: erro, nada criado');
    check(!fs.existsSync(LOG), 'e-mail inexistente não gera linha de log');
    const others = async () => JSON.stringify((await pool.query('SELECT id, is_platform_admin FROM users WHERE id <> $1 ORDER BY id', [student.id])).rows);
    const othersBefore = await others();

    r = grant(['--email', student.email.toUpperCase()]);
    check(r.code === 0 && /Antes .*is_platform_admin=false/.test(r.out) && /Depois.*is_platform_admin=true/.test(r.out), 'concede (e-mail em maiúsculas): mostra antes e depois', r.out);
    check((await flagOf(student.id)) === true, 'marcador gravado');
    check((await others()) === othersBefore, 'nenhuma outra conta foi alterada');
    const logLine = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').pop()! : '';
    check(new RegExp(`^\\d{4}-\\d\\d-\\d\\dT.* email=${student.email} acao=grant por=${os.userInfo().username}$`, 'i').test(logLine), 'linha de log com data, e-mail, ação e usuário do sistema', logLine);

    console.log('\n— Efeito no portal (mesma sessão, sem esperar o JWT expirar) —');
    const login = await call('/auth/login', { method: 'POST', body: { email: student.email, password: PASSWORD } });
    const token = login.body.accessToken as string;
    let me = await call('/portal/me', { token });
    check(me.status === 200 && me.body.role === 'student' && me.body.isPlatformAdmin === true, 'aluno com marcador: /portal/me => role student, isPlatformAdmin true', me.body);
    check(Object.keys(me.body).sort().join(',') === 'email,id,isPlatformAdmin,name,role', 'só expõe id, name, email, role e isPlatformAdmin', Object.keys(me.body));
    check((await runGuard(requirePlatformAdmin, student.id, 'student')) === 'ok', 'aluno com marcador passa em requirePlatformAdmin');

    r = grant(['--email', student.email, '--revoke']);
    check(r.code === 0 && /Depois.*is_platform_admin=false/.test(r.out), 'revoga');
    me = await call('/portal/me', { token });
    check(me.status === 200 && me.body.isPlatformAdmin === false, 'após revogar, a MESMA sessão já vê isPlatformAdmin=false');
    check((await runGuard(requirePlatformAdmin, student.id, 'student')) === 403, 'após revogar, requirePlatformAdmin barra na próxima requisição');

    console.log('\n— Conta desativada —');
    grant(['--email', student.email]);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [student.id]);
    check((await runGuard(requirePlatformAdmin, student.id, 'student')) === 401, 'desativada com marcador: requirePlatformAdmin barra (401)');
    check((await runGuard(requirePortalAccess, student.id, 'student')) === 401, 'desativada: requirePortalAccess barra');
    check((await call('/portal/me', { token })).status === 401, 'desativada: /portal/me => 401 mesmo com JWT válido');
    r = grant(['--email', student.email, '--revoke']);
    check(/desativada/.test(r.out), 'script avisa quando a conta está desativada');

    console.log('\n— Login do portal aceita qualquer conta ativa —');
    const portalLogin = await fetch(`${API}/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fitos-Portal': '1' }, body: JSON.stringify({ email: trainer.email, password: PASSWORD }) });
    check(portalLogin.status === 200, 'profissional entra');
    const studentLogin = await fetch(`${API}/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fitos-Portal': '1' }, body: JSON.stringify({ email: sneaky.email, password: PASSWORD }) });
    check(studentLogin.status === 200, 'aluno ativo também entra (a permissão é decidida rota por rota)');
  } finally {
    for (const email of emails) await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => undefined);
    await pool.end();
    fs.rmSync(LOG, { force: true });
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
