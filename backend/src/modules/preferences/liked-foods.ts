import { pool } from '../../database/pool';
import type { CtxFood } from '../onboarding/food-context';
import type { FoodCatalogItem } from './food-catalog';

const COLS = 'id, name, source, kcal_per_100g AS kcal, protein_per_100g AS protein, carb_per_100g AS carb, fat_per_100g AS fat';
const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Um alimento da TACO para cada item que a pessoa gosta (o mais curto e já preparado, ex.: "cozido", "grelhado"),
 * para a IA poder usá-lo no plano. Itens sem correspondência na TACO ficam de fora: a IA não inventa alimentos.
 */
export async function resolveLikedFoods(likes: FoodCatalogItem[]): Promise<CtxFood[]> {
  const out: CtxFood[] = [];
  for (const item of likes) {
    if (!item.taco) continue;
    for (const term of item.searchTerms) {
      const words = strip(term).split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM foods
          WHERE source = 'taco' AND (SELECT bool_and(name_search ~ ('\\m' || w || '\\M')) FROM unnest($1::text[]) w)
          ORDER BY (name_search ~ '\\m(cozid[oa]|grelhad[oa]|assad[oa])\\M') DESC, length(name)
          LIMIT 1`,
        [words],
      );
      if (rows[0]) {
        out.push({ id: rows[0].id, name: rows[0].name, source: rows[0].source, kcal: Number(rows[0].kcal), protein: Number(rows[0].protein), carb: Number(rows[0].carb), fat: Number(rows[0].fat) });
        break;
      }
    }
  }
  return out;
}
