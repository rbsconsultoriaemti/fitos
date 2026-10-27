import { pool } from '../../database/pool';
import { FOOD_CATALOG, FOOD_CATEGORY_LABELS, type FoodCatalogItem } from './food-catalog';

export type Stance = 'like' | 'dislike';

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s: string) => new Set(strip(s).split(/[^a-z0-9]+/).filter(Boolean));

const BY_KEY = new Map(FOOD_CATALOG.map((i) => [i.key, i]));

/** Catálogo + resposta do usuário (indiferente = sem linha). */
export async function getFoodPreferences(userId: string) {
  const { rows } = await pool.query<{ item_key: string; stance: Stance }>('SELECT item_key, stance FROM food_preferences WHERE user_id = $1', [userId]);
  const stances = new Map(rows.map((r) => [r.item_key, r.stance]));
  return {
    categories: Object.entries(FOOD_CATEGORY_LABELS).map(([key, label]) => ({ key, label })),
    items: FOOD_CATALOG.map((i) => ({ key: i.key, label: i.label, category: i.category, stance: stances.get(i.key) ?? 'indifferent' })),
  };
}

/** Grava o conjunto inteiro: apaga o que havia e insere likes/dislikes (idempotente). */
export async function saveFoodPreferences(userId: string, likes: string[], dislikes: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM food_preferences WHERE user_id = $1', [userId]);
    if (likes.length) {
      await client.query(`INSERT INTO food_preferences (user_id, item_key, stance) SELECT $1, k, 'like' FROM unnest($2::text[]) k`, [userId, likes]);
    }
    if (dislikes.length) {
      await client.query(`INSERT INTO food_preferences (user_id, item_key, stance) SELECT $1, k, 'dislike' FROM unnest($2::text[]) k`, [userId, dislikes]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return { liked: likes.length, disliked: dislikes.length };
}

export interface Preferences {
  like: FoodCatalogItem[];
  dislike: FoodCatalogItem[];
  /** 0 = gosta, 1 = indiferente, 2 = não gosta (não gosta vence quando o alimento casa com os dois). */
  rank: (foodName: string) => 0 | 1 | 2;
  isEmpty: boolean;
}

function matcher(items: FoodCatalogItem[]) {
  const terms = items.filter((i) => i.taco).flatMap((i) => i.searchTerms.map((t) => strip(t).split(/\s+/).filter(Boolean))).filter((t) => t.length > 0);
  return (foodWords: Set<string>) => terms.some((t) => t.every((w) => foodWords.has(w)));
}

export function buildPreferences(likeKeys: string[], dislikeKeys: string[]): Preferences {
  const like = likeKeys.map((k) => BY_KEY.get(k)).filter((i): i is FoodCatalogItem => !!i);
  const dislike = dislikeKeys.map((k) => BY_KEY.get(k)).filter((i): i is FoodCatalogItem => !!i);
  const isLike = matcher(like);
  const isDislike = matcher(dislike);
  return {
    like,
    dislike,
    isEmpty: like.length === 0 && dislike.length === 0,
    rank: (name) => {
      const w = words(name);
      if (isDislike(w)) return 2;
      if (isLike(w)) return 0;
      return 1;
    },
  };
}

export async function loadPreferences(userId: string): Promise<Preferences> {
  const { rows } = await pool.query<{ item_key: string; stance: Stance }>('SELECT item_key, stance FROM food_preferences WHERE user_id = $1', [userId]);
  return buildPreferences(
    rows.filter((r) => r.stance === 'like').map((r) => r.item_key),
    rows.filter((r) => r.stance === 'dislike').map((r) => r.item_key),
  );
}

/** Reordena (sort estável): gosta primeiro, indiferente, não gosta por último; ninguém é removido. */
export function sortByPreference<T>(rows: T[], prefs: Preferences | null, nameOf: (r: T) => string): T[] {
  if (!prefs || prefs.isEmpty) return rows;
  return rows.map((r, i) => ({ r, i, k: prefs.rank(nameOf(r)) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r);
}
