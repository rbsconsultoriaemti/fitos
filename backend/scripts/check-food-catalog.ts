/**
 * Confere o campo `taco` de cada item do catálogo de preferências contra a tabela `foods` (source = 'taco').
 *
 *   npm run check:food-catalog
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { FOOD_CATALOG, FOOD_CATEGORY_LABELS } from '../src/modules/preferences/food-catalog';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const keys = new Set<string>();
  let wrong = 0;
  let tacoCount = 0;
  const byCat = new Map<string, string[]>();
  for (const it of FOOD_CATALOG) {
    if (keys.has(it.key)) {
      console.log(`✘ chave duplicada: ${it.key}`);
      wrong++;
    }
    keys.add(it.key);
    if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(it.key)) {
      console.log(`✘ chave fora de snake_case: ${it.key}`);
      wrong++;
    }
    let matches: string[] = [];
    for (const term of it.searchTerms) {
      const toks = term.split(/\s+/).filter(Boolean);
      const { rows } = await pool.query(
        `SELECT name FROM foods WHERE source = 'taco' AND (SELECT bool_and(name_search ~ ('\\m' || t || '\\M')) FROM unnest($1::text[]) t) LIMIT 3`,
        [toks],
      );
      matches = matches.concat(rows.map((r) => r.name as string));
    }
    const found = matches.length > 0;
    if (found) tacoCount++;
    if (found !== it.taco) {
      wrong++;
      console.log(`✘ ${it.key}: taco=${it.taco}, mas ${found ? 'há' : 'não há'} correspondência (${it.searchTerms.join(' | ') || 'sem termos'})${found ? ` → ${matches[0]}` : ''}`);
    }
    const arr = byCat.get(it.category) ?? [];
    arr.push(`${it.label}${it.taco ? '' : ' (sem TACO)'}`);
    byCat.set(it.category, arr);
  }
  for (const [cat, labels] of byCat) console.log(`\n${FOOD_CATEGORY_LABELS[cat as keyof typeof FOOD_CATEGORY_LABELS]} (${labels.length}): ${labels.join(', ')}`);
  console.log(`\nTotal: ${FOOD_CATALOG.length} itens · com TACO: ${tacoCount} · sem TACO: ${FOOD_CATALOG.length - tacoCount} · divergências: ${wrong}`);
  await pool.end();
  process.exit(wrong === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
