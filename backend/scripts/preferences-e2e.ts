/**
 * Teste das preferências alimentares: validação do PUT, gravação idempotente, GET com as respostas e ordenação
 * da busca de alimentos (gosto sobe, não gosto desce, ninguém some). Inclui a lógica pura de ranking.
 *
 *   npm run test:preferences
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { Pool } from 'pg';
import { FOOD_CATALOG } from '../src/modules/preferences/food-catalog';
import { buildPreferences, sortByPreference } from '../src/modules/preferences/preferences.service';

const PORT = 3993;
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

type Food = { id: string; name: string };

async function main() {
  console.log('— Ranking (lógica pura) —');
  const prefs = buildPreferences(['frango_grelhado'], ['frango_frito', 'batata_frita', 'coxa_sobrecoxa']);
  check(prefs.rank('Frango, peito, sem pele, grelhado') === 0, 'alimento de que gosta => 0');
  check(prefs.rank('Batata, inglesa, frita') === 2, 'alimento de que não gosta => 2');
  check(prefs.rank('Maçã, Fuji, com casca, crua') === 1, 'alimento sem preferência => 1');
  check(prefs.rank('Frango, sobrecoxa, com pele, assada') === 2, 'ordem das palavras e acento não importam');
  const both = buildPreferences(['batata_frita'], ['batata_frita']);
  check(both.rank('Batata, inglesa, frita') === 2, 'se casa com os dois, "não gosta" vence');
  const list = ['b-indif', 'a-gosta', 'c-indif', 'd-naogosta', 'e-gosta'];
  const rk = buildPreferences([], []);
  check(sortByPreference(list, rk, (x) => x) === list, 'sem preferências a lista não muda (mesma referência)');
  const custom = { ...prefs, isEmpty: false, rank: (n: string) => (n.includes('gosta') && !n.includes('nao') ? 0 : n.includes('naogosta') ? 2 : 1) as 0 | 1 | 2 };
  check(JSON.stringify(sortByPreference(list, custom, (x) => x)) === JSON.stringify(['a-gosta', 'e-gosta', 'b-indif', 'c-indif', 'd-naogosta']), 'ordenação estável: gosta, indiferente, não gosta; ninguém some');
  check(buildPreferences(['tofu', 'whey_protein'], []).rank('Tofu') === 1, 'itens sem TACO não priorizam nada');

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
  const register = async (tag: string) => {
    const email = `pref-${tag}-${stamp}@teste.local`;
    emails.push(email);
    const r = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Teste Pref', email, password: 'SenhaTeste123!', role: 'student' }) });
    const token = ((await r.json()) as { accessToken: string }).accessToken;
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    return { token, id: rows[0].id as string };
  };
  const rowsOf = async (userId: string) => (await pool.query('SELECT item_key, stance FROM food_preferences WHERE user_id = $1 ORDER BY item_key', [userId])).rows;

  try {
    const a = await register('a');
    const b = await register('b');

    console.log('\n— GET /preferences/foods —');
    check((await call('/preferences/foods', null)).status === 401, 'sem token => 401');
    let g = await call('/preferences/foods', a.token);
    check(g.status === 200 && g.body.items.length === FOOD_CATALOG.length && g.body.categories.length === 8, `catálogo completo (${FOOD_CATALOG.length} itens, 8 categorias)`, g.status);
    check(g.body.items.every((i: { stance: string }) => i.stance === 'indifferent'), 'padrão: tudo indiferente');
    check(!('searchTerms' in g.body.items[0]), 'não expõe searchTerms');

    console.log('\n— PUT /preferences/foods: validação —');
    const bad = async (what: string, body: unknown) => {
      const r = await call('/preferences/foods', a.token, 'PUT', body);
      check(r.status === 400, what, r);
    };
    check((await call('/preferences/foods', null, 'PUT', { likes: [], dislikes: [] })).status === 401, 'sem token => 401');
    await bad('chave desconhecida => 400', { likes: ['abacaxi_com_pimenta'], dislikes: [] });
    await bad('item repetido => 400', { likes: ['banana', 'banana'], dislikes: [] });
    await bad('mesmo item em gosto e não gosto => 400', { likes: ['banana'], dislikes: ['banana'] });
    await bad('campo extra => 400', { likes: [], dislikes: [], neutral: [] });
    await bad('faltando dislikes => 400', { likes: [] });
    await bad('tipo errado => 400', { likes: 'banana', dislikes: [] });
    await bad('lista maior que o catálogo => 400', { likes: Array.from({ length: FOOD_CATALOG.length + 1 }, (_, i) => `x${i}`), dislikes: [] });
    check((await rowsOf(a.id)).length === 0, 'nada foi gravado pelas requisições inválidas');

    console.log('\n— PUT /preferences/foods: gravação —');
    const body1 = { likes: ['frango_cozido', 'banana', 'tofu'], dislikes: ['frango_frito', 'sardinha'] };
    let p = await call('/preferences/foods', a.token, 'PUT', body1);
    check(p.status === 200 && p.body.liked === 3 && p.body.disliked === 2, 'grava gosto/não gosto', p.body);
    const first = await rowsOf(a.id);
    p = await call('/preferences/foods', a.token, 'PUT', body1);
    const second = await rowsOf(a.id);
    check(p.status === 200 && JSON.stringify(first) === JSON.stringify(second) && second.length === 5, 'repetir o mesmo PUT não duplica (idempotente)', second);
    g = await call('/preferences/foods', a.token);
    const st = (k: string) => g.body.items.find((i: { key: string }) => i.key === k).stance;
    check(st('banana') === 'like' && st('sardinha') === 'dislike' && st('alface') === 'indifferent', 'GET devolve as respostas (indiferente = sem linha)');
    p = await call('/preferences/foods', a.token, 'PUT', { likes: ['banana'], dislikes: [] });
    check(p.status === 200 && (await rowsOf(a.id)).length === 1, 'PUT substitui o conjunto inteiro (o que não vem volta a indiferente)');
    check((await rowsOf(b.id)).length === 0, 'preferências de um usuário não aparecem para outro');

    console.log('\n— Busca de alimentos —');
    const search = async (token: string, q: string) => (await call(`/nutrition/foods?q=${encodeURIComponent(q)}`, token)).body as Food[];
    const base = await search(b.token, 'frango');
    check(base.length > 3, 'busca "frango" devolve vários alimentos', base.length);
    await call('/preferences/foods', a.token, 'PUT', { likes: ['coxa_sobrecoxa'], dislikes: ['frango_grelhado'] });
    const baseA = await search(a.token, 'frango');
    const ids = (l: Food[]) => l.map((f) => f.id).sort().join(',');
    check(ids(baseA) === ids(base), 'com preferências o conjunto de resultados é o mesmo (ninguém some)');
    const isLiked = (f: Food) => /\b(coxa|sobrecoxa)\b/i.test(f.name.normalize('NFD').replace(/\p{M}/gu, ''));
    const isDisliked = (f: Food) => /peito/i.test(f.name) && /grelhad/i.test(f.name);
    const likedIdx = baseA.map((f, i) => (isLiked(f) && !isDisliked(f) ? i : -1)).filter((i) => i >= 0);
    const neutralIdx = baseA.map((f, i) => (!isLiked(f) && !isDisliked(f) ? i : -1)).filter((i) => i >= 0);
    const dislikedIdx = baseA.map((f, i) => (isDisliked(f) ? i : -1)).filter((i) => i >= 0);
    check(likedIdx.length > 0 && dislikedIdx.length > 0 && neutralIdx.length > 0, 'resultado tem alimentos que gosta, indiferentes e que não gosta', { likedIdx, neutralIdx, dislikedIdx });
    check(Math.max(...likedIdx) < Math.min(...neutralIdx), '"gosta" vem antes de todos os indiferentes');
    check(Math.max(...neutralIdx) < Math.min(...dislikedIdx), '"não gosta" vem depois de todos os indiferentes');
    const baseNeutral = base.filter((f) => !isLiked(f) && !isDisliked(f)).map((f) => f.id);
    check(JSON.stringify(neutralIdx.map((i) => baseA[i].id)) === JSON.stringify(baseNeutral), 'a ordem entre os indiferentes é a da busca original');
    check(ids(await search(b.token, 'frango')) === ids(base), 'outro usuário continua com a busca original');
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
