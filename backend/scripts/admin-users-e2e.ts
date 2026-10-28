/**
 * Portal > Usuários e papéis (/portal/admin/*): só administrador da plataforma, troca de papel e ativação com auditoria,
 * proteções (própria conta, último administrador) e o marcador is_platform_admin intocável pela API.
 *
 *   npm run test:admin-users
 *
 * Atenção: o teste do "último administrador" tira o marcador, por alguns segundos, de outros administradores que já
 * existam NO BANCO LOCAL e o devolve no final (bloco finally). Rode só contra o banco de desenvolvimento.
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';
import { pool as appPool } from '../src/database/pool';
import { updateUser } from '../src/modules/portal/admin-users.service';
import { approveProfessional, isProfessional, registrationFor } from './test-helpers';

const PORT = 3996;
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
  return { status: r.status, text, body: text ? JSON.parse(text) : null };
}

/**
 * Este teste cria, altera e apaga contas e muda o marcador de administradores existentes. Antes de qualquer acesso ao
 * banco, recusa rodar em produção ou contra um banco que não seja local.
 */
function assertLocalOnly(): void {
  const refuse = (why: string): never => {
    console.error(`RECUSADO: test:admin-users altera dados e só roda no banco local de desenvolvimento. ${why}`);
    process.exit(2);
  };
  if (process.env.NODE_ENV === 'production') refuse('NODE_ENV=production.');
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    refuse('DATABASE_URL ausente ou inválida.');
  }
  if (host !== 'localhost' && host !== '127.0.0.1') refuse(`O host do DATABASE_URL é "${host}" (esperado localhost ou 127.0.0.1).`);
}

async function main() {
  assertLocalOnly();
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
  let demoted: string[] = [];

  const register = async (tag: string, role = 'student') => {
    const email = `adm-${tag}-${stamp}@teste.local`;
    emails.push(email);
    const r = await call('/auth/register', { method: 'POST', body: { name: `Adm ${tag} ${stamp}`, email, password: PASSWORD, role, ...registrationFor(role) } });
    const id = r.body.user.id as string;
    if (isProfessional(role)) await approveProfessional(pool, id);
    const token = async () => (await call('/portal/login', { method: 'POST', body: { email, password: PASSWORD }, headers: PORTAL })).body.accessToken as string;
    return { email, id, token };
  };
  const row = async (id: string) => (await pool.query('SELECT role, is_active, is_platform_admin FROM users WHERE id = $1', [id])).rows[0];
  const auditCount = async (target: string) => Number((await pool.query('SELECT count(*) n FROM admin_audit_log WHERE target_user_id = $1', [target])).rows[0].n);
  const patch = (token: string, id: string, body: unknown, headers: Record<string, string> = PORTAL) => call(`/portal/admin/users/${id}`, { method: 'PATCH', token, body, headers });

  try {
    const adminA = await register('a');
    const adminB = await register('b');
    const student = await register('aluno');
    const trainer = await register('trainer', 'trainer');
    const target = await register('alvo');
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = ANY($1)', [[adminA.id, adminB.id]]);
    const tokA = await adminA.token();
    const tokStudent = await student.token();
    const tokTrainer = await trainer.token();

    console.log('— Sem permissão —');
    const routes: [string, string, unknown?][] = [
      ['GET', '/portal/admin/users'],
      ['GET', `/portal/admin/users/${target.id}`],
      ['PATCH', `/portal/admin/users/${target.id}`, { role: 'trainer' }],
      ['GET', '/portal/admin/audit'],
    ];
    for (const [who, tok] of [['aluno', tokStudent], ['profissional', tokTrainer]] as const) {
      for (const [method, path, body] of routes) {
        const r = await call(path, { method, token: tok, body, headers: PORTAL });
        check(r.status === 403, `${who} ${method} ${path.replace(target.id, ':id')} => 403`, r.status);
      }
    }
    check((await call('/portal/admin/users')).status === 401, 'sem token => 401');
    check((await row(target.id)).role === 'student', 'a tentativa de PATCH sem permissão não alterou nada');

    console.log('\n— Listagem, busca e paginação —');
    let r = await call('/portal/admin/users?q=' + encodeURIComponent(`Adm a ${stamp}`), { token: tokA });
    check(r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === adminA.id, 'busca por nome (sem diferenciar maiúsculas)', r.body);
    r = await call('/portal/admin/users?q=' + encodeURIComponent(`ADM-ALUNO-${stamp}@TESTE.LOCAL`), { token: tokA });
    check(r.status === 200 && r.body.items.length === 1 && r.body.items[0].email === student.email, 'busca por e-mail (sem diferenciar maiúsculas)', r.body);
    check(r.body.items[0].isPlatformAdmin === false && r.body.items[0].isActive === true, 'item traz isActive e isPlatformAdmin');
    const keys = Object.keys(r.body.items[0]).sort().join(',');
    check(keys === 'createdAt,email,id,isActive,isPlatformAdmin,name,role', 'lista expõe só campos públicos', keys);
    check(!/password|hash|token/i.test(r.text), 'lista não vaza password_hash nem tokens');
    r = await call('/portal/admin/users?q=' + encodeURIComponent("' OR 1=1 --"), { token: tokA });
    check(r.status === 200 && r.body.total === 0, 'texto de injeção de SQL é só texto: 0 resultados', r.body.total);
    r = await call('/portal/admin/users?q=' + encodeURIComponent('%'), { token: tokA });
    check(r.status === 200 && r.body.items.every((u: { name: string; email: string }) => (u.name + u.email).includes('%')), '"%" é buscado literalmente (não é coringa)', r.body.total);

    await pool.query(
      `INSERT INTO users (name, email, password_hash) SELECT 'Paginacao ${stamp} ' || g, 'adm-pag-' || g || '-${stamp}@teste.local', 'x' FROM generate_series(1, 52) g`,
    );
    r = await call(`/portal/admin/users?q=Paginacao%20${stamp}`, { token: tokA });
    check(r.status === 200 && r.body.items.length === 50 && r.body.total === 52 && r.body.pageSize === 50 && r.body.page === 1, 'página 1: 50 itens de 52', { n: r.body.items?.length, total: r.body.total });
    const page1 = new Set(r.body.items.map((u: { id: string }) => u.id));
    r = await call(`/portal/admin/users?q=Paginacao%20${stamp}&page=2`, { token: tokA });
    check(r.body.items.length === 2 && r.body.items.every((u: { id: string }) => !page1.has(u.id)), 'página 2: os 2 restantes, sem repetir', r.body.items?.length);
    check((await call('/portal/admin/users?page=0', { token: tokA })).status === 400, 'page=0 => 400');

    console.log('\n— Detalhe —');
    r = await call(`/portal/admin/users/${target.id}`, { token: tokA });
    check(r.status === 200 && r.body.id === target.id && 'lastAccessAt' in r.body && 'profile' in r.body && r.body.protections.deactivate === null, 'detalhe com perfil, último acesso e proteções', r.body);
    check(!/password|hash/i.test(r.text), 'detalhe não vaza password_hash');
    check((await call('/portal/admin/users/nao-e-uuid', { token: tokA })).status === 400, 'id inválido => 400');
    check((await call('/portal/admin/users/00000000-0000-0000-0000-000000000000', { token: tokA })).status === 404, 'id inexistente => 404');

    console.log('\n— Troca de papel e auditoria —');
    r = await patch(tokA, target.id, { role: 'nutritionist' });
    check(r.status === 200 && r.body.role === 'nutritionist' && (await row(target.id)).role === 'nutritionist', 'administrador troca o papel', r.body);
    let audit = await call(`/portal/admin/audit?userId=${target.id}`, { token: tokA });
    const entry = audit.body.items[0];
    check(audit.status === 200 && audit.body.total === 1 && entry.actorId === adminA.id && entry.action === 'role_change', 'auditoria gravada com o autor', audit.body);
    check(entry.before.role === 'student' && entry.after.role === 'nutritionist', 'auditoria com before e after', entry);
    check(typeof entry.actorName === 'string' && !/password|hash/i.test(audit.text), 'auditoria mostra o autor e não vaza dados sensíveis');
    r = await patch(tokA, target.id, { role: 'nutritionist' });
    check(r.status === 200 && (await auditCount(target.id)) === 1, 'repetir o mesmo papel não gera auditoria');
    r = await patch(tokA, target.id, { isActive: false });
    check(r.status === 200 && r.body.isActive === false && (await row(target.id)).is_active === false, 'administrador desativa outra conta');
    r = await patch(tokA, target.id, { isActive: true });
    check(r.status === 200 && r.body.isActive === true, 'e reativa');
    audit = await call(`/portal/admin/audit?userId=${target.id}`, { token: tokA });
    check(audit.body.total === 3 && audit.body.items[0].action === 'activate' && audit.body.items[0].before.isActive === false && audit.body.items[0].after.isActive === true, 'ativar/desativar também entram na auditoria', audit.body.items.map((i: { action: string }) => i.action));
    check((await call('/portal/admin/audit?userId=xx', { token: tokA })).status === 400, 'audit com userId inválido => 400');
    check((await call('/portal/admin/audit', { token: tokA })).status === 200, 'audit sem filtro => 200');

    console.log('\n— Papel admin e marcador são recusados —');
    const before = await row(target.id);
    const bad: [string, unknown][] = [
      ['role "admin"', { role: 'admin' }],
      ['isPlatformAdmin', { isPlatformAdmin: true }],
      ['is_platform_admin', { is_platform_admin: true }],
      ['role válido + isPlatformAdmin', { role: 'trainer', isPlatformAdmin: true }],
      ['campo desconhecido', { role: 'trainer', foo: 1 }],
      ['papel inexistente', { role: 'dono' }],
      ['corpo vazio', {}],
      ['isActive não booleano', { isActive: 'false' }],
    ];
    for (const [what, body] of bad) {
      r = await patch(tokA, target.id, body);
      check(r.status === 400, `${what} => 400`, r.status);
    }
    const afterRow = await row(target.id);
    check(JSON.stringify(before) === JSON.stringify(afterRow), 'nada foi alterado pelas requisições recusadas', afterRow);
    check((await auditCount(target.id)) === 3, 'e nada foi auditado');
    r = await patch(tokA, target.id, { role: 'trainer' }, {});
    check(r.status === 400 && (await row(target.id)).role === 'nutritionist', 'PATCH sem X-Fitos-Portal => 400 e nada muda');

    console.log('\n— Própria conta —');
    r = await patch(tokA, adminA.id, { isActive: false });
    check(r.status === 409 && r.body.error === 'self_deactivate' && (await row(adminA.id)).is_active === true, 'não desativa a própria conta', r.body);
    r = await patch(tokA, adminA.id, { role: 'trainer' });
    check(r.status === 409 && r.body.error === 'self_role_change' && (await row(adminA.id)).role === 'student', 'não troca o próprio papel', r.body);
    r = await call(`/portal/admin/users/${adminA.id}`, { token: tokA });
    check(r.body.protections.deactivate !== null && r.body.protections.roleChange !== null, 'detalhe da própria conta traz o motivo das proibições (a tela os mostra)', r.body.protections);
    check((await auditCount(adminA.id)) === 0, 'nada auditado para as tentativas recusadas');

    console.log('\n— Último administrador —');
    const others = (await pool.query('SELECT id FROM users WHERE is_platform_admin AND is_active AND id <> ALL($1)', [[adminA.id, adminB.id]])).rows.map((x) => x.id as string);
    demoted = others;
    if (others.length) await pool.query('UPDATE users SET is_platform_admin = false WHERE id = ANY($1)', [others]);
    // Disputa no serviço (as duas chamadas já passaram pelos guards): A e B se desativam ao mesmo tempo. A transação
    // trava os administradores ativos; uma passa e a outra tem de receber 409 last_platform_admin, nunca outro resultado.
    const outcome = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number; code?: string }) => `${e.status}:${e.code}`);
    const results = await Promise.all([outcome(updateUser(adminA.id, adminB.id, { isActive: false })), outcome(updateUser(adminB.id, adminA.id, { isActive: false }))]);
    check(results.filter((x) => x === 200).length === 1 && results.filter((x) => x === '409:last_platform_admin').length === 1, 'desativações simultâneas: uma passa (200) e a outra recebe 409 last_platform_admin', results);
    const left = Number((await pool.query('SELECT count(*) n FROM users WHERE id = ANY($1) AND is_platform_admin AND is_active', [[adminA.id, adminB.id]])).rows[0].n);
    check(left === 1, 'sobra exatamente um administrador ativo', left);
    check((await pool.query("SELECT count(*) n FROM admin_audit_log WHERE action = 'deactivate' AND actor_id = ANY($1) AND target_user_id = ANY($1)", [[adminA.id, adminB.id]])).rows[0].n === '1', 'só a desativação que passou foi auditada');
    // Direto no serviço: um ator qualquer tentando desativar o único administrador ativo.
    const sole = (await pool.query('SELECT id FROM users WHERE id = ANY($1) AND is_platform_admin AND is_active', [[adminA.id, adminB.id]])).rows[0].id as string;
    let code = '';
    await updateUser(student.id, sole, { isActive: false }).catch((e) => (code = e.code));
    check(code === 'last_platform_admin' && (await row(sole)).is_active === true, 'serviço recusa desativar o único administrador ativo');
    await pool.query('UPDATE users SET is_active = true WHERE id = ANY($1)', [[adminA.id, adminB.id]]);
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = ANY($1)', [others]);
    demoted = [];

    console.log('\n— Conta desativada perde o acesso na próxima requisição —');
    const tokTarget = await target.token();
    const refreshHeaders = (await call('/portal/login', { method: 'POST', body: { email: target.email, password: PASSWORD }, headers: PORTAL }));
    check((await call('/portal/me', { token: tokTarget })).status === 200, 'antes: /portal/me => 200');
    const tokA2 = await adminA.token();
    r = await patch(tokA2, target.id, { isActive: false });
    check(r.status === 200, 'administrador desativa a conta', r.body);
    check((await call('/portal/me', { token: tokTarget })).status === 401, 'JWT ainda válido, mas /portal/me => 401 na próxima requisição');
    check((await call('/portal/admin/users', { token: tokTarget })).status === 401, 'rotas do portal => 401');
    check((await call('/portal/login', { method: 'POST', body: { email: target.email, password: PASSWORD }, headers: PORTAL })).status === 401, 'login recusado');
    const live = Number((await pool.query('SELECT count(*) n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [target.id])).rows[0].n);
    check(live === 0 && refreshHeaders.status === 200, 'sessões (refresh tokens) revogadas na desativação', live);
    // Administrador que perde a conta perde também o acesso às rotas de administração.
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [adminB.id]);
    check((await call('/portal/admin/users', { token: await adminB.token().catch(() => 'x') })).status === 401, 'administrador desativado => 401 nas rotas de administração');

    console.log('\n— Auditoria é somente de inserção —');
    const del = await pool.query('DELETE FROM admin_audit_log WHERE target_user_id = $1', [target.id]).then(() => 'ok', (e) => String(e.message));
    const upd = await pool.query("UPDATE admin_audit_log SET action = 'x' WHERE target_user_id = $1", [target.id]).then(() => 'ok', (e) => String(e.message));
    check(/somente de inserção/.test(del) && /somente de inserção/.test(upd), 'DELETE e UPDATE na tabela são recusados pelo banco', { del, upd });
  } finally {
    if (demoted.length) await pool.query('UPDATE users SET is_platform_admin = true WHERE id = ANY($1)', [demoted]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`adm-%-${stamp}@teste.local`]).catch(() => undefined);
    await pool.end();
    await appPool.end().catch(() => undefined);
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
