/**
 * Filtro "Sem glúten" da busca de alimentos: GET /nutrition/foods?glutenFree=true só devolve alimentos
 * marcados (foods.gluten_free), com e sem texto de busca, e combina com a categoria. Sem o filtro nada muda.
 *
 *   npm run test:gluten-free
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';

const PORT = 3996;
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

async function call(path: string, token: string | null) {
  const r = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
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
  const category = `teste-gf-${stamp}`;
  const email = `gf-${stamp}@teste.local`;

  try {
    const r = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Teste Glúten', email, password: 'SenhaTeste123!', role: 'student' }),
    });
    const token = ((await r.json()) as { accessToken: string }).accessToken;

    await pool.query(
      `INSERT INTO foods (name, source, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, gluten_free) VALUES
       ($1, 'custom', $3, 100, 5, 20, 1, true),
       ($2, 'custom', $3, 100, 5, 20, 1, false)`,
      [`Gluten teste ${stamp} livre`, `Gluten teste ${stamp} comum`, category],
    );
    const q = encodeURIComponent(`gluten teste ${stamp}`);

    console.log('— Com texto de busca —');
    const semFiltro = await call(`/nutrition/foods?q=${q}`, token);
    check(semFiltro.status === 200 && semFiltro.body.length === 2, 'sem o filtro: os dois alimentos aparecem', semFiltro.body?.length);
    const comFiltro = await call(`/nutrition/foods?q=${q}&glutenFree=true`, token);
    check(comFiltro.body.length === 1 && comFiltro.body[0].name.endsWith('livre'), 'glutenFree=true: só o marcado', comFiltro.body);
    check(comFiltro.body[0]?.glutenFree === true, 'resposta traz glutenFree: true', comFiltro.body[0]);
    const falso = await call(`/nutrition/foods?q=${q}&glutenFree=false`, token);
    check(falso.body.length === 2, 'glutenFree=false: não filtra', falso.body?.length);
    const comum = await call(`/nutrition/foods?q=${q}`, token);
    check(comum.body.find((f: { name: string }) => f.name.endsWith('comum'))?.glutenFree === false, 'alimento não marcado vem com glutenFree: false');

    console.log('\n— Sem texto de busca, com categoria —');
    const porCategoria = await call(`/nutrition/foods?category=${category}&glutenFree=true`, token);
    check(porCategoria.body.length === 1 && porCategoria.body[0].glutenFree === true, 'categoria + glutenFree=true: só o marcado', porCategoria.body);
    const todos = await call(`/nutrition/foods?category=${category}`, token);
    check(todos.body.length === 2, 'categoria sem o filtro: os dois', todos.body?.length);

    console.log('\n— Validação —');
    const invalido = await call(`/nutrition/foods?q=${q}&glutenFree=talvez`, token);
    check(invalido.status === 400, 'glutenFree com valor inválido => 400', invalido.status);
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
