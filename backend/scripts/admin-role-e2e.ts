/**
 * Acesso ao portal web: qualquer conta ativa entra (a permissão é decidida rota por rota); token inválido => 401; refresh token só em cookie
 * httpOnly (com rotação); papel e conta ativa conferidos no banco (não só no JWT). Também testa o `requireRole`.
 * (O marcador de administrador e os middlewares por permissão estão em test:platform-admin.)
 *
 *   npm run test:admin-role
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';
import type { NextFunction, Request, Response } from 'express';
import { requireRole } from '../src/modules/auth/auth.middleware';
import { approveProfessional, isProfessional, registrationFor } from './test-helpers';

const PORT = 3994;
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

const PASSWORD = 'SenhaTeste123!';
const PORTAL = { 'X-Fitos-Portal': '1' };

async function call(path: string, opts: { token?: string | null; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const r = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, setCookie: r.headers.getSetCookie() };
}
const cookieOf = (setCookie: string[]) => setCookie.find((c) => c.startsWith('fitos_portal_rt='));
const cookieHeader = (setCookie: string[]) => ({ ...PORTAL, Cookie: (cookieOf(setCookie) ?? '').split(';')[0] });

async function main() {
  console.log('— requireRole (unitário) —');
  const run = (role: string | undefined, allowed: Parameters<typeof requireRole>) => {
    let result: unknown = 'pending';
    requireRole(...allowed)({ auth: role ? { sub: 'x', role } : undefined } as unknown as Request, {} as Response, ((e?: { status?: number }) => (result = e ? e.status : 'ok')) as NextFunction);
    return result;
  };
  check(run('student', ['trainer', 'admin']) === 403, 'aluno fora da lista => 403');
  check(run('trainer', ['trainer', 'admin']) === 'ok', 'trainer na lista => passa');
  check(run('admin', ['trainer', 'admin']) === 'ok', 'admin na lista => passa');
  check(run(undefined, ['admin']) === 403, 'sem auth => 403');

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
  const register = async (tag: string, role: string) => {
    const email = `portal-${tag}-${stamp}@teste.local`;
    emails.push(email);
    const r = await call('/auth/register', { method: 'POST', body: { name: 'Teste Portal', email, password: PASSWORD, role: role === 'admin' ? 'student' : role, ...registrationFor(role) } });
    if (isProfessional(role)) await approveProfessional(pool, r.body.user.id);
    if (role === 'admin') await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
    return { email, id: r.body.user.id as string };
  };

  try {
    const student = await register('aluno', 'student');
    const trainer = await register('trainer', 'trainer');
    const admin = await register('admin', 'admin');
    const nutri = await register('nutri', 'nutritionist');
    const login = (email: string, headers: Record<string, string> = PORTAL) => call('/portal/login', { method: 'POST', body: { email, password: PASSWORD }, headers });

    console.log('\n— POST /portal/login —');
    let r = await login(student.email);
    check(r.status === 200 && r.body.user.role === 'student' && !!cookieOf(r.setCookie), 'aluno ativo também entra (a permissão é decidida rota por rota)', r);
    check(!('refreshToken' in r.body), 'aluno: refresh token também fica só no cookie');
    r = await call('/portal/login', { method: 'POST', body: { email: trainer.email, password: 'errada-123' }, headers: PORTAL });
    check(r.status === 401, 'senha errada => 401');
    r = await login(trainer.email, {});
    check(r.status === 400, 'sem o cabeçalho X-Fitos-Portal => 400 (defesa CSRF)');

    r = await login(trainer.email);
    check(r.status === 200 && !!r.body.accessToken && r.body.user.role === 'trainer', 'trainer entra', r.body);
    check(!('refreshToken' in r.body), 'refresh token NÃO vai no corpo');
    const ck = cookieOf(r.setCookie) ?? '';
    check(/HttpOnly/i.test(ck) && /SameSite=Strict/i.test(ck) && /Path=\/portal(;|$)/.test(ck), 'cookie httpOnly, SameSite=Strict e restrito a /portal', ck);
    const trainerLogin = r;
    r = await login(admin.email);
    check(r.status === 200 && r.body.user.role === 'admin', 'admin entra');
    const adminLogin = r;
    r = await login(nutri.email);
    check(r.status === 200, 'nutricionista entra');

    console.log('\n— GET /portal/me —');
    check((await call('/portal/me')).status === 401, 'sem token => 401');
    check((await call('/portal/me', { token: 'lixo' })).status === 401, 'token inválido => 401');
    r = await call('/portal/me', { token: trainerLogin.body.accessToken });
    check(r.status === 200 && r.body.role === 'trainer', 'trainer => 200');
    check((await call('/portal/me', { token: adminLogin.body.accessToken })).status === 200, 'admin => 200');
    const studentToken = (await call('/auth/login', { method: 'POST', body: { email: student.email, password: PASSWORD } })).body.accessToken;
    r = await call('/portal/me', { token: studentToken });
    check(r.status === 200 && r.body.role === 'student' && r.body.isPlatformAdmin === false, 'token de aluno => 200 com role student e isPlatformAdmin false', r.body);
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [student.id]);
    r = await call('/portal/me', { token: studentToken });
    check(r.status === 200 && r.body.role === 'student' && r.body.isPlatformAdmin === true, 'aluno com marcador => 200 com isPlatformAdmin true (mesma sessão)', r.body);
    await pool.query('UPDATE users SET is_platform_admin = false WHERE id = $1', [student.id]);

    console.log('\n— refresh por cookie —');
    r = await call('/portal/refresh', { method: 'POST', headers: cookieHeader(trainerLogin.setCookie) });
    check(r.status === 200 && !!r.body.accessToken && !!cookieOf(r.setCookie), 'cookie válido => novo access token e novo cookie', r);
    const rotated = r;
    r = await call('/portal/refresh', { method: 'POST', headers: cookieHeader(trainerLogin.setCookie) });
    check(r.status === 401, 'cookie antigo (já usado) => 401 (rotação)');
    r = await call('/portal/refresh', { method: 'POST', headers: cookieHeader(rotated.setCookie) });
    check(r.status === 401, 'reuso derruba a família inteira de tokens');
    check((await call('/portal/refresh', { method: 'POST', headers: PORTAL })).status === 401, 'sem cookie => 401');
    check((await call('/portal/refresh', { method: 'POST', body: { refreshToken: 'x' }, headers: PORTAL })).status === 401, 'refresh token no corpo é ignorado => 401');
    check((await call('/portal/refresh', { method: 'POST', headers: { Cookie: 'fitos_portal_rt=abc' } })).status === 400, 'sem o cabeçalho => 400');

    console.log('\n— logout —');
    const again = await login(trainer.email);
    r = await call('/portal/logout', { method: 'POST', headers: cookieHeader(again.setCookie) });
    check(r.status === 204 && /Max-Age=0/.test(cookieOf(r.setCookie) ?? ''), 'logout limpa o cookie');
    check((await call('/portal/refresh', { method: 'POST', headers: cookieHeader(again.setCookie) })).status === 401, 'depois do logout o refresh falha');

    console.log('\n— papel e conta conferidos no banco —');
    const t2 = await login(trainer.email);
    await pool.query("UPDATE users SET role = 'student' WHERE id = $1", [trainer.id]);
    r = await call('/portal/me', { token: t2.body.accessToken });
    check(r.status === 200 && r.body.role === 'student', 'rebaixado para aluno: o JWT antigo ainda diz trainer, mas /portal/me devolve o papel atual do banco', r.body);
    r = await call('/portal/refresh', { method: 'POST', headers: cookieHeader(t2.setCookie) });
    check(r.status === 200 && r.body.user.role === 'student', 'rebaixado: refresh continua valendo, com o papel novo');
    await pool.query("UPDATE users SET role = 'trainer', is_active = false WHERE id = $1", [trainer.id]);
    check((await call('/portal/me', { token: t2.body.accessToken })).status === 401, 'conta desativada: JWT ainda válido, mas /portal/me => 401');
    check((await login(trainer.email)).status === 401, 'conta desativada não faz login');
    await pool.query('UPDATE users SET is_platform_admin = true, is_active = false WHERE id = $1', [student.id]);
    check((await call('/portal/me', { token: studentToken })).status === 401, 'aluno com marcador, mas desativado: /portal/me => 401');
    check((await login(student.email)).status === 401, 'aluno com marcador, mas desativado, não faz login');
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
