import { pool } from '../pool';
import { mapOffProduct, OFF_FIELDS, offFetch, upsertOffFood } from '../../modules/nutrition/openfoodfacts';

/**
 * Importa produtos brasileiros do Open Food Facts (https://world.openfoodfacts.org, licença ODbL) para foods
 * com source='openfoodfacts'. Só entram produtos com código de barras brasileiro (789/790), nome e todos os
 * macros por 100 g (kcal, proteína, carboidrato, gordura) plausíveis. Idempotente por código de barras.
 *
 * Uso: npm run seed:openfoodfacts [-- --pages 20] — cada página tem 100 produtos, ordenados por popularidade.
 * A busca do OFF é limitada (~10 requisições/min), por isso há uma pausa entre páginas.
 */

const PAGE_SIZE = 100;
const PAUSE_MS = 7_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pagesArg() {
  const i = process.argv.indexOf('--pages');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 10;
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error('--pages deve ser um inteiro entre 1 e 500');
  return n;
}

async function fetchPage(page: number) {
  const path =
    `/api/v2/search?countries_tags_en=brazil&fields=${OFF_FIELDS}&page_size=${PAGE_SIZE}&page=${page}` +
    '&sort_by=unique_scans_n';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await offFetch(path, 60_000).catch(() => null);
    if (res?.ok) return ((await res.json()) as { products: unknown[] }).products;
    console.warn(`  página ${page}: HTTP ${res?.status ?? 'erro de rede'} (tentativa ${attempt}/3)`);
    await sleep(PAUSE_MS * attempt * 2);
  }
  return null;
}

async function main() {
  const pages = pagesArg();
  let seen = 0;
  let brazilian = 0;
  let saved = 0;

  for (let page = 1; page <= pages; page++) {
    const products = await fetchPage(page);
    if (products === null) {
      console.error(`Parei na página ${page}: o Open Food Facts não respondeu.`);
      break;
    }
    if (products.length === 0) break;

    for (const p of products as { code?: string }[]) {
      seen++;
      if (!/^(789|790)/.test(String(p.code ?? ''))) continue;
      brazilian++;
      const food = mapOffProduct(p);
      if (!food) continue;
      await upsertOffFood(food);
      saved++;
    }
    console.log(`página ${page}/${pages}: ${seen} lidos · ${brazilian} com código brasileiro · ${saved} salvos`);
    if (products.length < PAGE_SIZE) break;
    if (page < pages) await sleep(PAUSE_MS);
  }

  console.log(`Concluído: ${saved} produtos salvos (de ${brazilian} brasileiros, ${seen} lidos).`);
  console.log('Fonte: Open Food Facts (ODbL) — mantenha a atribuição ao usar estes dados.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
