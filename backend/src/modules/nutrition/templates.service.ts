import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { displayFoodName } from '../../shared/food-name';
import { AccessTokenPayload } from '../auth/auth.service';
import { ApplyTemplateInput, CreateTemplateInput } from './nutrition.schemas';
import { createLogs, resolveQuantity } from './nutrition.service';

type Auth = AccessTokenPayload;

interface StoredItem {
  foodId: string;
  quantityG?: number;
  portion?: { label: string; count: number };
}

interface TemplateRow {
  id: string;
  name: string;
  meal_type: string | null;
  items: StoredItem[];
  created_at: Date;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const notFound = () => new AppError(404, 'not_found', 'Refeição favorita não encontrada');

/** Refeição favorita: um conjunto de alimentos e quantidades para registrar de uma vez. */
export async function createTemplate(auth: Auth, input: CreateTemplateInput) {
  const foodIds = [...new Set(input.items.map((i) => i.foodId))];
  const { rowCount } = await pool.query('SELECT 1 FROM foods WHERE id = ANY($1::uuid[])', [foodIds]);
  if (rowCount !== foodIds.length) throw new AppError(400, 'unknown_food', 'Um ou mais alimentos não existem');

  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO meal_templates (user_id, name, meal_type, items) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [auth.sub, input.name, input.mealType ?? null, JSON.stringify(input.items)],
    );
    return (await listTemplates(auth)).find((t) => t.id === rows[0].id)!;
  } catch (err: any) {
    if (err?.code === '23505') throw new AppError(409, 'template_exists', 'Você já tem uma favorita com esse nome');
    throw err;
  }
}

/** Favoritas do usuário, com nome, quantidade e macros de cada alimento. */
export async function listTemplates(auth: Auth) {
  const { rows } = await pool.query<TemplateRow>(
    'SELECT id, name, meal_type, items, created_at FROM meal_templates WHERE user_id = $1 ORDER BY created_at DESC',
    [auth.sub],
  );
  const foodIds = [...new Set(rows.flatMap((t) => t.items.map((i) => i.foodId)))];
  const { rows: foods } = foodIds.length
    ? await pool.query(
        `SELECT id, name, source, category, portions, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g
         FROM foods WHERE id = ANY($1::uuid[])`,
        [foodIds],
      )
    : { rows: [] as any[] };
  const byId = new Map(foods.map((f) => [f.id, f]));

  return rows.map((t) => {
    const items = t.items.flatMap((i) => {
      const food = byId.get(i.foodId);
      if (!food) return []; // alimento removido da base: some da favorita
      const q = resolveQuantity(food, i);
      const f = q.quantityG / 100;
      return [
        {
          foodId: i.foodId,
          name: food.name as string,
          displayName: displayFoodName(food.name, food.source, food.category),
          quantityG: q.quantityG,
          portion: q.portionLabel ? { label: q.portionLabel, count: Number(q.portionCount) } : null,
          kcal: round1(Number(food.kcal_per_100g) * f),
          proteinG: round1(Number(food.protein_per_100g) * f),
          carbG: round1(Number(food.carb_per_100g) * f),
          fatG: round1(Number(food.fat_per_100g) * f),
        },
      ];
    });
    const sum = (k: 'kcal' | 'proteinG' | 'carbG' | 'fatG') => round1(items.reduce((a, i) => a + i[k], 0));
    return {
      id: t.id,
      name: t.name,
      mealType: t.meal_type,
      items,
      totals: { kcal: sum('kcal'), proteinG: sum('proteinG'), carbG: sum('carbG'), fatG: sum('fatG') },
    };
  });
}

/** Registra todos os itens da favorita de uma vez, na refeição pedida (ou na da própria favorita). */
export async function applyTemplate(auth: Auth, id: string, input: ApplyTemplateInput) {
  const { rows } = await pool.query<TemplateRow>(
    'SELECT id, name, meal_type, items, created_at FROM meal_templates WHERE id = $1 AND user_id = $2',
    [id, auth.sub],
  );
  const template = rows[0];
  if (!template) throw notFound();

  const mealType = input.mealType ?? (template.meal_type as CreateTemplateInput['mealType']);
  if (!mealType) throw new AppError(400, 'meal_required', 'Informe a refeição (mealType)');

  return createLogs(auth, {
    items: template.items.map((i) => ({ ...i, mealType })),
    loggedAt: input.loggedAt,
    recognitionSource: 'manual',
  });
}

export async function deleteTemplate(auth: Auth, id: string) {
  const { rowCount } = await pool.query('DELETE FROM meal_templates WHERE id = $1 AND user_id = $2', [id, auth.sub]);
  if (!rowCount) throw notFound();
}
