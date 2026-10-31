/**
 * Portal > Catálogo de alimentos (/portal/admin/foods): só administrador da plataforma; edição com trilha de auditoria
 * (só o que mudou de fato); ocultar tira o alimento da busca dos alunos, mas o histórico continua acessível.
 *
 *   npm run test:admin-catalog
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';

const PORT = 3997;
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
  const name = `Catalogo teste ${stamp}`;

  const register = async (tag: string) => {
    const email = `cat-${tag}-${stamp}@teste.local`;
    const r = await call('/auth/register', { method: 'POST', body: { name: `Cat ${tag} ${stamp}`, email, password: PASSWORD, role: 'student' } });
    const id = r.body.user.id as string;
    return { email, id, token: async () => (await call('/portal/login', { method: 'POST', body: { email, password: PASSWORD }, headers: PORTAL })).body.accessToken as string };
  };

  try {
    const admin = await register('admin');
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [admin.id]);
    const student = await register('aluno');
    const tokAdmin = await admin.token();
    const tokStudent = await student.token();

    const { rows: [food] } = await pool.query<{ id: string }>(
      `INSERT INTO foods (name, source, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g)
       VALUES ($1, 'custom', 'teste', 100, 5, 20, 1) RETURNING id`,
      [name],
    );
    const foodId = food.id;
    const auditCount = async () => Number((await pool.query('SELECT count(*) n FROM catalog_audit_log WHERE entity_id = $1', [foodId])).rows[0].n);

    console.log('— Sem permissão —');
    check((await call('/portal/admin/foods', { token: tokStudent })).status === 403, 'aluno lista o catálogo => 403');
    check((await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokStudent, body: { hidden: true }, headers: PORTAL })).status === 403, 'aluno não edita => 403');
    check((await call('/portal/admin/foods')).status === 401, 'sem token => 401');
    const still = await pool.query('SELECT hidden FROM foods WHERE id = $1', [foodId]);
    check(still.rows[0].hidden === false, 'a tentativa do aluno não ocultou nada');

    console.log('\n— Listagem —');
    let r = await call(`/portal/admin/foods?q=${encodeURIComponent(name)}`, { token: tokAdmin });
    check(r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === foodId, 'busca encontra o alimento pelo nome', r.body);
    const item = r.body.items[0];
    check(item.glutenFree === false && item.hidden === false && Array.isArray(item.portions), 'item traz glutenFree, hidden e portions', item);

    console.log('\n— Edição e auditoria —');
    r = await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokAdmin, body: { glutenFree: true } });
    check(r.status === 400, 'PATCH sem o cabeçalho do portal => 400', r.status);
    r = await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokAdmin, body: { glutenFree: true }, headers: PORTAL });
    check(r.status === 200 && r.body.glutenFree === true, 'marca como sem glúten', r.body);
    check((await auditCount()) === 1, 'uma linha de auditoria');
    r = await call(`/portal/admin/foods/${foodId}/audit`, { token: tokAdmin });
    check(r.body.items[0]?.before.glutenFree === false && r.body.items[0]?.after.glutenFree === true, 'auditoria guarda antes e depois', r.body);
    check(r.body.items[0]?.actorName === `Cat admin ${stamp}`, 'auditoria mostra quem fez', r.body.items[0]);

    r = await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokAdmin, body: { glutenFree: true }, headers: PORTAL });
    check(r.status === 200 && (await auditCount()) === 1, 'repetir o valor atual não gera linha de auditoria');

    const portionsA = [{ label: 'colher', grams: 10 }];
    await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokAdmin, body: { portions: portionsA }, headers: PORTAL });
    check((await auditCount()) === 2, 'mudar porções gera linha');
    await pool.query("UPDATE foods SET portions = '[{\"grams\": 10, \"label\": \"colher\"}]'::jsonb WHERE id = $1", [foodId]);
    r = await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokAdmin, body: { portions: portionsA }, headers: PORTAL });
    check(r.status === 200 && (await auditCount()) === 2, 'porções iguais em outra ordem de chaves não geram linha falsa');

    r = await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokAdmin, body: { isPlatformAdmin: true, hidden: true }, headers: PORTAL });
    check(r.status === 400, 'campo extra vira 400', r.status);
    r = await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokAdmin, body: {}, headers: PORTAL });
    check(r.status === 400, 'corpo vazio => 400', r.status);
    r = await call(`/portal/admin/foods/00000000-0000-4000-8000-000000000000`, { method: 'PATCH', token: tokAdmin, body: { hidden: true }, headers: PORTAL });
    check(r.status === 404, 'alimento inexistente => 404', r.status);

    console.log('\n— Ocultar —');
    r = await call(`/portal/admin/foods/${foodId}`, { method: 'PATCH', token: tokAdmin, body: { hidden: true }, headers: PORTAL });
    check(r.status === 200 && r.body.hidden === true, 'oculta o alimento', r.body);
    const busca = await call(`/nutrition/foods?q=${encodeURIComponent(name)}`, { token: tokStudent });
    check(busca.status === 200 && busca.body.length === 0, 'aluno não encontra mais na busca', busca.body);
    const direto = await call(`/nutrition/foods/${foodId}`, { token: tokStudent });
    check(direto.status === 200 && direto.body.id === foodId, 'aluno ainda abre o alimento pelo id (histórico)', direto.status);
    r = await call(`/portal/admin/foods?hidden=true&q=${encodeURIComponent(name)}`, { token: tokAdmin });
    check(r.body.items.length === 1, 'admin vê o oculto com o filtro hidden=true', r.body);
    r = await call(`/portal/admin/foods?glutenFree=true&q=${encodeURIComponent(name)}`, { token: tokAdmin });
    check(r.body.items.length === 1 && r.body.items[0].glutenFree === true, 'filtro glutenFree=true funciona', r.body);

    console.log('\n— Trilha imutável —');
    let blocked = false;
    try {
      await pool.query('UPDATE catalog_audit_log SET action = $2 WHERE entity_id = $1', [foodId, 'x']);
    } catch {
      blocked = true;
    }
    check(blocked, 'UPDATE na trilha é recusado pelo banco');
    blocked = false;
    try {
      await pool.query('DELETE FROM catalog_audit_log WHERE entity_id = $1', [foodId]);
    } catch {
      blocked = true;
    }
    check(blocked, 'DELETE na trilha é recusado pelo banco');
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
