import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { displayFoodName } from '../../shared/food-name';
import { PAGE_SIZE } from './admin-users.schemas';

const FOOD_COLUMNS = `id, name, source, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g,
  portions, gluten_free, hidden`;

interface FoodRow {
  id: string;
  name: string;
  source: string;
  category: string | null;
  kcal_per_100g: string;
  protein_per_100g: string;
  carb_per_100g: string;
  fat_per_100g: string;
  portions: { label: string; grams: number }[];
  gluten_free: boolean;
  hidden: boolean;
}

const present = (f: FoodRow) => ({
  id: f.id,
  name: f.name,
  displayName: displayFoodName(f.name, f.source, f.category),
  source: f.source,
  category: f.category,
  kcalPer100g: Number(f.kcal_per_100g),
  proteinPer100g: Number(f.protein_per_100g),
  carbPer100g: Number(f.carb_per_100g),
  fatPer100g: Number(f.fat_per_100g),
  portions: f.portions,
  glutenFree: f.gluten_free,
  hidden: f.hidden,
});

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const notFound = (what: string) => new AppError(404, 'not_found', `${what} não encontrado`);

/** Porções na mesma ordem e com as mesmas chaves, para comparar sem falso positivo (o jsonb reordena as chaves). */
const canonPortions = (ps: { label: string; grams: number }[]) => ps.map((p) => ({ label: p.label, grams: p.grams }));

/** Lista do catálogo para o administrador: inclui os ocultos (ao contrário da busca dos alunos). */
export async function listFoods(filter: { q?: string; page: number; hidden?: boolean; glutenFree?: boolean }) {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter.q) {
    params.push(`%${likeEscape(filter.q.toLowerCase())}%`);
    conds.push(`name_search LIKE f_unaccent($${params.length})`);
  }
  if (filter.hidden !== undefined) {
    params.push(filter.hidden);
    conds.push(`hidden = $${params.length}`);
  }
  if (filter.glutenFree !== undefined) {
    params.push(filter.glutenFree);
    conds.push(`gluten_free = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM foods ${where}`, params)).rows[0].n);
  const { rows } = await pool.query<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods ${where} ORDER BY name, id LIMIT ${PAGE_SIZE} OFFSET ${(filter.page - 1) * PAGE_SIZE}`,
    params,
  );
  return { items: rows.map(present), page: filter.page, pageSize: PAGE_SIZE, total };
}

export interface FoodPatch {
  glutenFree?: boolean;
  hidden?: boolean;
  portions?: { label: string; grams: number }[];
}

/**
 * Edita o alimento e grava a trilha. Só entram na auditoria os campos que mudaram de fato; repetir o valor atual
 * não gera linha. Tudo numa transação, com a linha travada, para que duas edições não percam o histórico.
 */
export async function updateFood(actorId: string, id: string, patch: FoodPatch) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<FoodRow>(`SELECT ${FOOD_COLUMNS} FROM foods WHERE id = $1 FOR UPDATE`, [id]);
    const food = rows[0];
    if (!food) throw notFound('Alimento');

    const current = { glutenFree: food.gluten_free, hidden: food.hidden, portions: food.portions };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['glutenFree', 'hidden', 'portions'] as const) {
      const next = patch[key];
      if (next === undefined) continue;
      const same =
        key === 'portions'
          ? JSON.stringify(canonPortions(next as { label: string; grams: number }[])) === JSON.stringify(canonPortions(current.portions))
          : next === current[key];
      if (same) continue;
      before[key] = current[key];
      after[key] = next;
    }

    if (Object.keys(after).length === 0) {
      await client.query('COMMIT');
      return present(food);
    }

    const sets: string[] = [];
    const params: unknown[] = [id];
    if ('glutenFree' in after) {
      params.push(after.glutenFree);
      sets.push(`gluten_free = $${params.length}`);
    }
    if ('hidden' in after) {
      params.push(after.hidden);
      sets.push(`hidden = $${params.length}`);
    }
    if ('portions' in after) {
      params.push(JSON.stringify(after.portions));
      sets.push(`portions = $${params.length}::jsonb`);
    }
    const updated = await client.query<FoodRow>(`UPDATE foods SET ${sets.join(', ')} WHERE id = $1 RETURNING ${FOOD_COLUMNS}`, params);
    await client.query(
      `INSERT INTO catalog_audit_log (actor_id, entity, entity_id, action, before, after) VALUES ($1, 'food', $2, 'update', $3, $4)`,
      [actorId, id, JSON.stringify(before), JSON.stringify(after)],
    );
    await client.query('COMMIT');
    return present(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Trilha de alterações de um alimento (somente leitura), mais recentes primeiro. */
export async function listFoodAudit(foodId: string) {
  const { rows } = await pool.query<{ id: string; actor_name: string | null; action: string; before: unknown; after: unknown; created_at: Date }>(
    `SELECT a.id, u.name AS actor_name, a.action, a.before, a.after, a.created_at
       FROM catalog_audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity = 'food' AND a.entity_id = $1
      ORDER BY a.created_at DESC, a.id LIMIT 50`,
    [foodId],
  );
  return rows.map((r) => ({ id: r.id, actorName: r.actor_name, action: r.action, before: r.before, after: r.after, createdAt: r.created_at }));
}
