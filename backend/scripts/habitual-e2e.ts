/**
 * Teste da frequência das refeições favoritas: cada uso conta (POST /templates/:id/used e POST /templates/:id/apply),
 * só a dona conta, e GET /templates devolve useCount e lastUsedAt.
 *
 *   npm run test:habitual
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';

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
  const register = async (tag: string) => {
    const email = `habitual-${tag}-${stamp}@teste.local`;
    const r = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Teste Habitual', email, password: 'SenhaTeste123!', role: 'student' }),
    });
    const token = ((await r.json()) as { accessToken: string }).accessToken;
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    return { token, id: rows[0].id as string };
  };

  try {
    const a = await register('a');
    const b = await register('b');
    // Alimento próprio do teste (não depende do catálogo carregado no banco).
    const { rows: foods } = await pool.query(
      "INSERT INTO foods (name, source, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g) VALUES ($1, 'custom', 'teste', 100, 5, 20, 1) RETURNING id",
      [`Teste habitual ${stamp}`],
    );
    const foodId = foods[0].id as string;

    const cafe = await call('/nutrition/templates', a.token, 'POST', { name: `Café ${stamp}`, mealType: 'breakfast', items: [{ foodId, quantityG: 100 }] });
    const almoco = await call('/nutrition/templates', a.token, 'POST', { name: `Almoço ${stamp}`, mealType: 'lunch', items: [{ foodId, quantityG: 150 }] });
    check(cafe.status === 201 && almoco.status === 201, 'favoritas criadas');
    const cafeId = cafe.body.id as string;
    const almocoId = almoco.body.id as string;

    console.log('\n— Contagem —');
    let list = await call('/nutrition/templates', a.token);
    const fresh = list.body.find((t: { id: string }) => t.id === cafeId);
    check(fresh.useCount === 0 && fresh.lastUsedAt === null, 'começa com 0 usos e sem último uso', fresh);

    check((await call(`/nutrition/templates/${cafeId}/used`, null, 'POST')).status === 401, 'sem token => 401');
    check((await call(`/nutrition/templates/${cafeId}/used`, b.token, 'POST')).status === 404, 'outro usuário não conta o uso => 404');
    check((await call('/nutrition/templates/00000000-0000-4000-8000-000000000000/used', a.token, 'POST')).status === 404, 'favorita inexistente => 404');
    check((await call('/nutrition/templates/nao-e-uuid/used', a.token, 'POST')).status === 400, 'id que não é UUID => 400 (validação, como nas outras rotas)');

    for (let i = 0; i < 3; i++) check((await call(`/nutrition/templates/${cafeId}/used`, a.token, 'POST')).status === 204, `uso ${i + 1} do café => 204`);
    check((await call(`/nutrition/templates/${almocoId}/used`, a.token, 'POST')).status === 204, 'uso do almoço => 204');

    list = await call('/nutrition/templates', a.token);
    const cafeRow = list.body.find((t: { id: string }) => t.id === cafeId);
    const almocoRow = list.body.find((t: { id: string }) => t.id === almocoId);
    check(cafeRow.useCount === 3, 'café: useCount 3', cafeRow.useCount);
    check(almocoRow.useCount === 1, 'almoço: useCount 1', almocoRow.useCount);
    check(typeof cafeRow.lastUsedAt === 'string' && !Number.isNaN(Date.parse(cafeRow.lastUsedAt)), 'lastUsedAt é uma data ISO', cafeRow.lastUsedAt);

    console.log('\n— Aplicar favorita também conta —');
    const applied = await call(`/nutrition/templates/${almocoId}/apply`, a.token, 'POST', { mealType: 'lunch' });
    check(applied.status === 201, 'aplicar almoço => 201', applied.status);
    list = await call('/nutrition/templates', a.token);
    check(list.body.find((t: { id: string }) => t.id === almocoId).useCount === 2, 'aplicar soma no almoço (agora 2)');

    console.log('\n— Isolamento —');
    const other = await call('/nutrition/templates', b.token);
    check(other.body.length === 0, 'a lista de outro usuário não mostra as favoritas de a');
    const { rows: counts } = await pool.query('SELECT use_count FROM meal_templates WHERE id = $1', [cafeId]);
    check(counts[0].use_count === 3, 'uso de outro usuário não alterou a contagem', counts[0]);
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
