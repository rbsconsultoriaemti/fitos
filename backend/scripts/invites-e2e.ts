/**
 * Convites do portal (/portal/invites/*) e validação de profissionais (/portal/admin/professionals/*).
 *
 *   npm run test:invites
 *
 * Altera dados: só roda no banco local (ver scripts/local-only.ts).
 */
import 'dotenv/config';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { assertLocalOnly } from './local-only';
import { approveProfessional, isProfessional, registrationFor } from './test-helpers';

const PORT = 3997;
const PORT_LIMIT = 3998; // segunda instância, limite de aceitação baixo, atrás de 1 proxy (Traefik)
const PORT_NOPROXY = 3999; // terceira, mesmo limite, sem proxy confiável (X-Forwarded-For deve ser ignorado)
const PASSWORD = 'SenhaTeste123!';
const PORTAL = { 'X-Fitos-Portal': '1' };

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

async function startServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), ...env }, shell: true });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/health`)).ok) break;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return server;
}

const callOn = (port: number) => async (path: string, opts: { token?: string | null; method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const r = await fetch(`http://localhost:${port}${path}`, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  return { status: r.status, text, body: text ? JSON.parse(text) : null };
};

async function main() {
  assertLocalOnly('test:invites');
  const server = await startServer(PORT, { INVITE_ACCEPT_PER_15MIN: '1000' });
  const limited = await startServer(PORT_LIMIT, { INVITE_ACCEPT_PER_15MIN: '3', TRUST_PROXY_HOPS: '1' });
  const noProxy = await startServer(PORT_NOPROXY, { INVITE_ACCEPT_PER_15MIN: '3', TRUST_PROXY_HOPS: '0' });
  const call = callOn(PORT);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const stamp = Date.now();
  const tag = `inv-${stamp}`;

  const register = async (name: string, role = 'student') => {
    const email = `${tag}-${name}@teste.local`;
    const r = await call('/auth/register', { method: 'POST', body: { name: `Inv ${name} ${stamp}`, email, password: PASSWORD, role, ...registrationFor(role) } });
    const id = r.body.user.id as string;
    if (isProfessional(role)) await approveProfessional(pool, id);
    const token = async () => (await call('/portal/login', { method: 'POST', body: { email, password: PASSWORD }, headers: PORTAL })).body.accessToken as string;
    return { email, id, token };
  };
  const create = (token: string, body: unknown, headers = PORTAL) => call('/portal/invites', { method: 'POST', token, body, headers });
  const tokenOf = (link: string) => link.slice(link.lastIndexOf('/') + 1);
  const accept = (t: string, body: unknown) => call(`/portal/invites/token/${t}/accept`, { method: 'POST', body });
  const newUser = (n: string) => ({ name: `Convidado ${n}`, email: `${tag}-${n}@teste.local`, password: PASSWORD });
  const dbUser = async (email: string) => (await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email])).rows[0];

  try {
    const admin = await register('admin');
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [admin.id]);
    const trainer = await register('trainer', 'trainer');
    const trainer2 = await register('trainer2', 'trainer');
    const student = await register('aluno');
    const tAdmin = await admin.token();
    const tTrainer = await trainer.token();
    const tTrainer2 = await trainer2.token();
    const tStudent = await student.token();

    console.log('— Quem cria convites —');
    let r = await create(tAdmin, { role: 'student' });
    check(r.status === 201 && typeof r.body.link === 'string' && r.body.role === 'student', 'administrador cria convite de aluno', r.body);
    const adminStudentInvite = r.body;
    r = await create(tAdmin, { role: 'trainer' });
    check(r.status === 201, 'administrador cria convite de trainer', r.body);
    const adminTrainerInvite = r.body;
    r = await create(tAdmin, { role: 'admin' });
    check(r.status === 400, 'administrador NÃO cria convite de admin => 400', r.body);
    r = await create(tTrainer, { role: 'student' });
    check(r.status === 201, 'profissional cria convite de aluno');
    const proStudentInvite = r.body;
    r = await create(tTrainer, { role: 'nutritionist' });
    check(r.status === 201, 'profissional cria convite de nutritionist');
    const proNutriInvite = r.body;
    r = await create(tTrainer, { role: 'admin' });
    check(r.status === 400, 'profissional NÃO cria convite de admin => 400');
    check((await create(tAdmin, { role: 'student', isPlatformAdmin: true })).status === 400, 'campo extra (isPlatformAdmin) => 400');
    check((await create(tAdmin, { role: 'student', expiresInDays: 0 })).status === 400 && (await create(tAdmin, { role: 'student', expiresInDays: 15 })).status === 400, 'expiresInDays fora de 1..14 => 400');
    r = await create(tAdmin, { role: 'student', expiresInDays: 14 });
    check(r.status === 201 && Math.abs(new Date(r.body.expiresAt).getTime() - Date.now() - 14 * 86400000) < 60000, 'expiresInDays=14 vale');
    const days = (new Date(adminStudentInvite.expiresAt).getTime() - Date.now()) / 86400000;
    check(days > 6.99 && days <= 7, 'validade padrão: 7 dias', days);
    check((await create(tAdmin, { role: 'student' }, {})).status === 400, 'sem X-Fitos-Portal => 400');

    for (const [what, call2] of [
      ['POST /portal/invites', () => create(tStudent, { role: 'student' })],
      ['GET /portal/invites', () => call('/portal/invites', { token: tStudent })],
      ['POST /portal/invites/:id/revoke', () => call(`/portal/invites/${adminStudentInvite.id}/revoke`, { method: 'POST', token: tStudent, headers: PORTAL })],
    ] as const) {
      check((await call2()).status === 403, `aluno recebe 403 em ${what}`);
    }
    check((await call('/portal/invites', { method: 'POST', body: { role: 'student' }, headers: PORTAL })).status === 401, 'sem login => 401 para criar');

    console.log('\n— Token: tamanho, hash no banco, nunca em claro depois —');
    const plain = tokenOf(adminStudentInvite.link);
    check(Buffer.from(plain, 'base64url').length >= 32, 'token com 32+ bytes aleatórios', plain.length);
    const row = (await pool.query('SELECT token FROM invites WHERE id = $1', [adminStudentInvite.id])).rows[0];
    check(row.token === createHash('sha256').update(plain).digest('hex') && row.token !== plain, 'banco guarda só o hash SHA-256');
    check(Number((await pool.query('SELECT count(*) n FROM invites WHERE token = $1 OR email = $1', [plain])).rows[0].n) === 0, 'token em claro não existe em nenhuma linha');
    const audited = JSON.stringify((await pool.query('SELECT details FROM invite_audit_log WHERE invite_id = $1', [adminStudentInvite.id])).rows);
    check(!audited.includes(plain), 'nem na auditoria');
    const lists = [await call('/portal/invites', { token: tAdmin }), await call('/portal/invites', { token: tTrainer }), await call(`/portal/invites/token/${plain}`)];
    check(lists.every((x) => x.status === 200 && !x.text.includes(plain) && !x.text.includes(row.token) && !/"link"|"token"/.test(x.text)), 'token (e hash) não aparecem em nenhum GET depois da criação');
    check(Object.keys(lists[0].body.items[0]).sort().join(',') === 'createdAt,createdBy,email,expiresAt,id,revokedAt,role,status,usedAt', 'lista expõe só campos públicos', Object.keys(lists[0].body.items[0]));
    check(lists[2].body.role === 'student' && lists[2].body.invitedBy === `Inv admin ${stamp}` && !/sender|email|"id"/.test(lists[2].text.replace('requiresEmail', '')), 'consulta pública: papel, validade e só o NOME de quem convidou', lists[2].body);
    const mine = await call('/portal/invites', { token: tTrainer });
    check(mine.body.items.length === 2 && mine.body.items.every((i: { role: string }) => ['student', 'nutritionist'].includes(i.role)), 'profissional vê só os próprios convites');
    check(lists[0].body.total >= 5 && lists[0].body.pageSize === 50, 'administrador vê todos (paginado)');
    check((await call('/portal/invites?page=0', { token: tAdmin })).status === 400, 'page=0 => 400');

    console.log('\n— Aceitação: papel vem do convite —');
    r = await accept(plain, { ...newUser('aluno1'), role: 'admin', isPlatformAdmin: true, validationStatus: 'approved' });
    check(r.status === 201 && r.body.user.role === 'student', 'corpo com role:"admin" é ignorado: conta nasce student', r.body);
    let u = await dbUser(newUser('aluno1').email);
    check(u.role === 'student' && u.validation_status === 'approved' && u.is_platform_admin === false && u.registration_council === null, 'banco: student, approved, sem marcador', u);
    check(!r.text.includes('password'), 'resposta sem senha/hash');
    const li = await call('/portal/login', { method: 'POST', body: { email: newUser('aluno1').email, password: PASSWORD }, headers: PORTAL });
    check(li.status === 200, 'conta criada consegue entrar');
    r = await accept(plain, newUser('aluno2'));
    check(r.status === 410, 'convite já usado => 410', r.body);
    check((await call(`/portal/invites/token/${plain}`)).status === 410, 'consulta de convite usado => 410');
    const used = (await pool.query('SELECT status, used_at FROM invites WHERE id = $1', [adminStudentInvite.id])).rows[0];
    check(used.status === 'accepted' && used.used_at !== null, 'convite marcado como usado');

    console.log('\n— Profissional entra pendente —');
    const tTok = tokenOf(adminTrainerInvite.link);
    check((await accept(tTok, newUser('pro1'))).status === 400, 'profissional sem registro => 400');
    check((await accept(tTok, { ...newUser('pro1'), registrationState: 'SP', registrationCouncil: 'CRN', registrationNumber: '12345' })).status === 400, 'conselho errado para o papel (trainer com CRN) => 400');
    check((await accept(tTok, { ...newUser('pro1'), registrationState: 'SP', registrationCouncil: 'CREF' })).status === 400, 'CREF sem número => 400');
    check((await accept(tTok, { ...newUser('pro1'), registrationCouncil: 'CREF', registrationNumber: '012345' })).status === 400, 'sem UF => 400');
    check((await accept(tTok, { ...newUser('pro1'), registrationState: 'SP', registrationCouncil: 'CREF', registrationNumber: '<script>' })).status === 400, 'número com caracteres inválidos => 400');
    check((await call(`/portal/invites/token/${tTok}`)).status === 200, 'tentativas inválidas não consomem o convite');
    r = await accept(tTok, { ...newUser('pro1'), role: 'admin', registrationState: 'SP', registrationCouncil: 'CREF', registrationNumber: '012345-G/SP' });
    check(r.status === 201 && r.body.user.role === 'trainer' && r.body.user.validationStatus === 'pending', 'trainer aceito nasce pending (role:"admin" do corpo ignorado)', r.body);
    u = await dbUser(newUser('pro1').email);
    check(u.registration_council === 'CREF' && u.registration_number === '012345-G/SP' && u.validated_by === null && u.validated_at === null, 'conselho e número gravados; ninguém validou ainda', u);
    const pro1 = { email: newUser('pro1').email, id: u.id as string, token: async () => (await call('/portal/login', { method: 'POST', body: { email: newUser('pro1').email, password: PASSWORD }, headers: PORTAL })).body.accessToken as string };
    const tPro1 = await pro1.token();
    check(!!tPro1, 'profissional pendente consegue entrar (para ver o status)');
    check((await call('/portal/admin/users', { token: tPro1 })).status === 403 && (await call('/portal/admin/professionals/pending', { token: tPro1 })).status === 403, 'pendente recebe 403 nas telas de administração');
    r = await create(tPro1, { role: 'student' });
    check(r.status === 403 && r.body.error === 'professional_not_validated', 'pendente recebe 403 nas telas profissionais (criar convite)', r.body);
    check((await call('/portal/invites', { token: tPro1 })).status === 403, 'pendente recebe 403 ao listar convites');

    const nTok = tokenOf(proNutriInvite.link);
    check((await accept(nTok, { ...newUser('nutri'), registrationState: 'SP', registrationCouncil: 'CREF', registrationNumber: '1234' })).status === 400, 'nutricionista com CREF => 400');
    r = await accept(nTok, { ...newUser('nutri'), registrationState: 'SP', registrationCouncil: 'CRN', registrationNumber: 'CRN-3 12345' });
    check(r.status === 400, 'número com espaço => 400');
    r = await accept(nTok, { ...newUser('nutri'), registrationState: 'SP', registrationCouncil: 'CRN', registrationNumber: '12345' });
    check(r.status === 201 && r.body.user.validationStatus === 'pending', 'nutricionista com CRN fica pending');
    const nutriId = (await dbUser(newUser('nutri').email)).id as string;
    for (const [n, role, council, ok] of [['corr', 'running_coach', 'SEM_CONSELHO', true], ['cic', 'cycling_coach', 'CREF', true], ['psi', 'psychologist', 'CRP', true], ['psibad', 'psychologist', 'SEM_CONSELHO', false]] as const) {
      const inv = await create(tAdmin, { role });
      const rr = await accept(tokenOf(inv.body.link), { ...newUser(n), registrationState: 'SP', registrationCouncil: council, registrationNumber: council === 'SEM_CONSELHO' ? undefined : '999' });
      check(ok ? rr.status === 201 && rr.body.user.validationStatus === 'pending' : rr.status === 400, `${role} com ${council}: ${ok ? 'aceito e pendente' : 'recusado (400)'}`, rr.body);
    }
    const corr = await dbUser(newUser('corr').email);
    check(corr.registration_council === 'SEM_CONSELHO' && corr.registration_number === null, 'sem conselho: grava SEM_CONSELHO e número nulo');

    console.log('\n— Convite expirado, revogado, desconhecido —');
    const exp = await create(tAdmin, { role: 'student' });
    await pool.query("UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1", [exp.body.id]);
    check((await call(`/portal/invites/token/${tokenOf(exp.body.link)}`)).status === 410 && (await accept(tokenOf(exp.body.link), newUser('x1'))).status === 410, 'expirado => 410 (consulta e aceitação)');
    check((await call('/portal/invites', { token: tAdmin })).body.items.find((i: { id: string }) => i.id === exp.body.id)?.status === 'expired', 'lista mostra "expired"');
    const rev = await create(tTrainer, { role: 'student' });
    r = await call(`/portal/invites/${rev.body.id}/revoke`, { method: 'POST', token: tTrainer2, headers: PORTAL });
    check(r.status === 403, 'revogar convite de OUTRO profissional => 403', r.body);
    check((await call(`/portal/invites/${rev.body.id}/revoke`, { method: 'POST', token: tTrainer })).status === 400, 'revogar sem X-Fitos-Portal => 400');
    r = await call(`/portal/invites/${rev.body.id}/revoke`, { method: 'POST', token: tTrainer, headers: PORTAL });
    check(r.status === 200 && r.body.status === 'revoked' && r.body.revokedAt, 'dono revoga convite pendente', r.body);
    check((await call(`/portal/invites/${rev.body.id}/revoke`, { method: 'POST', token: tTrainer, headers: PORTAL })).status === 409, 'revogar de novo => 409');
    check((await call(`/portal/invites/token/${tokenOf(rev.body.link)}`)).status === 410 && (await accept(tokenOf(rev.body.link), newUser('x2'))).status === 410, 'revogado => 410');
    check((await call(`/portal/invites/${exp.body.id}/revoke`, { method: 'POST', token: tAdmin, headers: PORTAL })).status === 409, 'expirado não pode ser revogado => 409');
    check((await call(`/portal/invites/${adminStudentInvite.id}/revoke`, { method: 'POST', token: tAdmin, headers: PORTAL })).status === 409, 'usado não pode ser revogado => 409');
    const rev2 = await create(tTrainer, { role: 'student' });
    check((await call(`/portal/invites/${rev2.body.id}/revoke`, { method: 'POST', token: tAdmin, headers: PORTAL })).status === 200, 'administrador revoga convite de qualquer um');
    check((await call('/portal/invites/00000000-0000-0000-0000-000000000000/revoke', { method: 'POST', token: tAdmin, headers: PORTAL })).status === 404, 'convite inexistente => 404');
    check((await call(`/portal/invites/token/${'a'.repeat(43)}`)).status === 404, 'token desconhecido => 404');
    check((await call('/portal/invites/token/curto')).status === 400, 'token malformado => 400');

    console.log('\n— E-mail do convite e e-mail repetido —');
    const bound = await create(tAdmin, { role: 'student', email: `${tag}-Alvo@Teste.Local` });
    const bTok = tokenOf(bound.body.link);
    check((await call(`/portal/invites/token/${bTok}`)).body.requiresEmail === true, 'consulta informa que o convite é para um e-mail');
    check((await accept(bTok, newUser('outro'))).status === 403, 'e-mail diferente do convite => 403');
    check((await accept(bTok, newUser('aluno1'))).status === 403, 'e-mail já cadastrado e diferente => 403');
    const dup = await create(tAdmin, { role: 'student' });
    r = await accept(tokenOf(dup.body.link), newUser('aluno1'));
    check(r.status === 409 && (await call(`/portal/invites/token/${tokenOf(dup.body.link)}`)).status === 200, 'e-mail já cadastrado => 409 e o convite segue pendente');
    check((await accept(bTok, { ...newUser('alvo'), email: `${tag}-alvo@teste.local` })).status === 201, 'e-mail igual (sem diferenciar maiúsculas) aceita');

    console.log('\n— Validação pelo administrador —');
    r = await call('/portal/admin/professionals/pending', { token: tAdmin });
    const ids = r.body.items.map((i: { id: string }) => i.id);
    check(r.status === 200 && ids.includes(pro1.id) && ids.includes(nutriId) && !ids.includes(student.id), 'lista os pendentes', ids.length);
    const item = r.body.items.find((i: { id: string }) => i.id === pro1.id);
    check(item.registrationCouncil === 'CREF' && item.registrationNumber === '012345-G/SP' && !/password|hash/i.test(r.text), 'pendente mostra conselho e número, sem dados sensíveis');
    check((await call('/portal/admin/professionals/pending', { token: tTrainer })).status === 403 && (await call('/portal/admin/professionals/pending', { token: tStudent })).status === 403, 'não administrador: 403 na lista');
    for (const act of ['validate', 'reject']) {
      check((await call(`/portal/admin/professionals/${pro1.id}/${act}`, { method: 'POST', token: tTrainer, headers: PORTAL })).status === 403, `não administrador: 403 em ${act}`);
    }
    check((await call(`/portal/admin/professionals/${pro1.id}/validate`, { method: 'POST', token: tAdmin })).status === 400, 'validar sem X-Fitos-Portal => 400');
    check((await dbUser(newUser('pro1').email)).validation_status === 'pending', 'nada mudou com as tentativas recusadas');
    r = await call(`/portal/admin/professionals/${pro1.id}/validate`, { method: 'POST', token: tAdmin, headers: PORTAL });
    check(r.status === 200 && r.body.validationStatus === 'approved', 'administrador valida', r.body);
    u = await dbUser(newUser('pro1').email);
    check(u.validation_status === 'approved' && u.validated_by === admin.id && u.validated_at !== null, 'grava validated_by e validated_at');
    r = await create(tPro1, { role: 'student' });
    check(r.status === 201, 'aprovado passa a poder convidar (mesmo token de antes: a conta é lida do banco)', r.body);
    check((await call(`/portal/admin/professionals/${pro1.id}/validate`, { method: 'POST', token: tAdmin, headers: PORTAL })).status === 409, 'validar quem não está pendente => 409');
    r = await call(`/portal/admin/professionals/${nutriId}/reject`, { method: 'POST', token: tAdmin, headers: PORTAL });
    check(r.status === 200 && r.body.validationStatus === 'rejected', 'administrador rejeita');
    const tNutri = (await call('/portal/login', { method: 'POST', body: { email: newUser('nutri').email, password: PASSWORD }, headers: PORTAL })).body.accessToken;
    check((await create(tNutri, { role: 'student' })).status === 403, 'rejeitado continua bloqueado (403)');
    check((await call('/portal/admin/professionals/pending', { token: tAdmin })).body.items.every((i: { id: string }) => i.id !== nutriId && i.id !== pro1.id), 'sai da lista de pendentes');
    r = await call(`/portal/admin/professionals/${nutriId}/validate`, { method: 'POST', token: tAdmin, headers: PORTAL });
    check(r.status === 409 && /rejeitado/.test(r.body.message) && /final/.test(r.body.message), 'rejeição é final pela API: validar depois => 409 com mensagem clara', r.body);
    r = await call(`/portal/admin/professionals/${pro1.id}/reject`, { method: 'POST', token: tAdmin, headers: PORTAL });
    check(r.status === 409 && /já foi validado/.test(r.body.message), 'rejeitar quem já foi validado => 409 com mensagem clara', r.body);
    check((await dbUser(newUser('nutri').email)).validation_status === 'rejected' && (await dbUser(newUser('pro1').email)).validation_status === 'approved', 'e nada mudou');
    check((await call(`/portal/admin/professionals/${student.id}/validate`, { method: 'POST', token: tAdmin, headers: PORTAL })).status === 404, 'validar quem não é profissional => 404');
    const aud = (await pool.query("SELECT action, before, after, actor_id FROM admin_audit_log WHERE target_user_id = ANY($1) AND action LIKE 'professional_%' ORDER BY action", [[pro1.id, nutriId]])).rows;
    check(aud.length === 2 && aud[0].action === 'professional_reject' && aud[1].action === 'professional_validate' && aud.every((a) => a.actor_id === admin.id && a.before.validationStatus === 'pending'), 'validação e rejeição vão para admin_audit_log com before/after', aud);

    const hist = await call(`/portal/admin/audit?userId=${pro1.id}`, { token: tAdmin });
    check(hist.status === 200 && hist.body.items[0].description === `Validado como professor de Ed. Física (CREF 012345-G/SP) por Inv admin ${stamp}`, 'histórico da conta traz texto legível da validação', hist.body.items?.[0]);
    const histN = await call(`/portal/admin/audit?userId=${nutriId}`, { token: tAdmin });
    check(histN.body.items[0].description === `Rejeitado como nutricionista (CRN 12345) por Inv admin ${stamp}`, 'e da rejeição', histN.body.items?.[0]);
    await call(`/portal/admin/users/${student.id}`, { method: 'PATCH', token: tAdmin, body: { role: 'trainer' }, headers: PORTAL });
    await call(`/portal/admin/users/${student.id}`, { method: 'PATCH', token: tAdmin, body: { isActive: false }, headers: PORTAL });
    const histS = await call(`/portal/admin/audit?userId=${student.id}`, { token: tAdmin });
    check(histS.body.items.length === 2 && histS.body.items[1].description === `Papel alterado de aluno para professor de Ed. Física por Inv admin ${stamp}` && histS.body.items[0].description === `Conta desativada por Inv admin ${stamp}`, 'papel e ativação também têm texto legível', histS.body.items.map((i: { description: string }) => i.description));
    const everyAudit = await call('/portal/admin/audit', { token: tAdmin });
    check(everyAudit.body.items.every((i: { description: string }) => typeof i.description === 'string' && i.description.length > 5), 'nenhuma linha do histórico sem texto');

    console.log('\n— Auditoria dos convites —');
    const actions = async (id: string) => (await pool.query('SELECT action, actor_id FROM invite_audit_log WHERE invite_id = $1 ORDER BY created_at', [id])).rows;
    let a = await actions(adminStudentInvite.id);
    check(a.map((x) => x.action).join() === 'invite_create,invite_accept' && a[0].actor_id === admin.id, 'criação e aceitação auditadas (aceitação com o id da conta criada)', a);
    a = await actions(rev.body.id);
    check(a.map((x) => x.action).join() === 'invite_create,invite_revoke' && a[1].actor_id === trainer.id, 'criação e revogação auditadas', a);
    check((await actions(adminTrainerInvite.id)).map((x) => x.action).join() === 'invite_create,invite_accept', 'aceitação do profissional auditada');
    check((await actions(exp.body.id)).length === 1, 'tentativas recusadas não geram linha');
    const del = await pool.query('DELETE FROM invite_audit_log WHERE invite_id = $1', [rev.body.id]).then(() => 'ok', (e) => String(e.message));
    const upd = await pool.query("UPDATE invite_audit_log SET action = 'x' WHERE invite_id = $1", [rev.body.id]).then(() => 'ok', (e) => String(e.message));
    check(/somente de inserção/.test(del) && /somente de inserção/.test(upd), 'DELETE e UPDATE na auditoria são recusados pelo banco', { del, upd });

    console.log('\n— Fluxo antigo de vínculo (/invites) não aceita convites do portal —');
    const sneaky = await create(tAdmin, { role: 'trainer' });
    r = await call('/invites/accept', { method: 'POST', token: tTrainer2, body: { token: tokenOf(sneaky.body.link) } });
    check(r.status === 404, 'POST /invites/accept com convite do portal (trainer) => 404', r);
    check((await call(`/portal/invites/token/${tokenOf(sneaky.body.link)}`)).status === 200, 'e o convite segue pendente');

    console.log('\n— Limites de uso —');
    const rl = await register('rl', 'trainer');
    const tRl = await rl.token();
    let ok = 0;
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await create(tRl, { role: 'student' })).status;
      if (last === 201) ok++;
    }
    check(ok === 30 && last === 429, 'criação: 30 por hora por usuário, o 31º => 429', { ok, last });
    check((await create(tTrainer2, { role: 'student' })).status === 201, 'o limite é por usuário (outro usuário não é afetado)');
    const lim = callOn(PORT_LIMIT);
    const probe = `/portal/invites/token/${'b'.repeat(43)}`;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await lim(probe)).status);
    check(codes.join() === '404,404,404,429,429', 'público: acima do limite por IP => 429', codes);
    // Atrás de 1 proxy (TRUST_PROXY_HOPS=1): cada cliente do X-Forwarded-For tem o seu balde.
    const xff = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } });
    const viaProxy: number[] = [];
    for (let i = 0; i < 4; i++) viaProxy.push((await lim(probe, xff('203.0.113.7'))).status);
    check(viaProxy.join() === '404,404,404,429', 'atrás do proxy: o IP do X-Forwarded-For tem balde próprio (4ª tentativa => 429)', viaProxy);
    check((await lim(probe, xff('203.0.113.8'))).status === 404, 'outro cliente atrás do mesmo proxy não é afetado');
    check((await lim(probe)).status === 429, 'sem o cabeçalho vale o IP da conexão (que já estourou)');
    // Sem proxy confiável: o cabeçalho é ignorado, então girar o IP forjado não escapa do limite.
    const limNo = callOn(PORT_NOPROXY);
    const spoof: number[] = [];
    for (let i = 0; i < 5; i++) spoof.push((await limNo(probe, xff(`198.51.100.${i + 1}`))).status);
    check(spoof.join() === '404,404,404,429,429', 'sem proxy confiável: X-Forwarded-For forjado não burla o limite', spoof);
    const throttled = await lim(`/portal/invites/token/${'b'.repeat(43)}/accept`, { method: 'POST', body: newUser('lim') });
    check(throttled.status === 429 && throttled.body.error === 'invite_rate_limited' && throttled.body.retryAfterSec > 0, 'aceitação compartilha o limite e informa quando tentar de novo', throttled.body);
  } finally {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`${tag}-%@teste.local`]).catch(() => undefined);
    await pool.end();
    server.kill();
    limited.kill();
    noProxy.kill();
    killPort(PORT);
    killPort(PORT_LIMIT);
    killPort(PORT_NOPROXY);
  }
  console.log(failures === 0 ? '\nTodos os testes passaram.' : `\n${failures} falha(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
