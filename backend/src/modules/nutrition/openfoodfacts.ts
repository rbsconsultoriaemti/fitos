import { PoolClient } from 'pg';
import { pool } from '../../database/pool';

// Open Food Facts (ODbL, https://world.openfoodfacts.org). Os dados são abertos, mas pedem atribuição ao
// reutilizar; a identificação do cliente (User-Agent) é exigida por eles.
const OFF_BASE = 'https://world.openfoodfacts.org';
const USER_AGENT = process.env.OFF_USER_AGENT ?? 'FitOS/0.1 (https://github.com/rbsconsultoriaemti/fitos)';
export const OFF_FIELDS = 'code,product_name,product_name_pt,brands,categories_tags,nutriments';

export interface OffFood {
  barcode: string;
  name: string;
  category: string | null;
  kcalPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Converte um produto do Open Food Facts em alimento. Devolve null se faltar código de barras, nome ou
 * algum macro (dados incompletos), ou se os números forem implausíveis (o OFF é colaborativo e tem lixo).
 */
export function mapOffProduct(p: any): OffFood | null {
  const barcode = String(p?.code ?? '');
  if (!/^\d{8,14}$/.test(barcode)) return null;

  const base = String(p.product_name_pt || p.product_name || '').trim();
  if (base.length < 2) return null;
  const brand = String(p.brands ?? '').split(',')[0].trim();
  const name = (brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${base} - ${brand}` : base).slice(0, 120);

  const n = p.nutriments ?? {};
  const kcalRaw = finite(n['energy-kcal_100g']) ? n['energy-kcal_100g'] : finite(n['energy-kj_100g']) ? n['energy-kj_100g'] / 4.184 : null;
  const protein = n['proteins_100g'];
  const carb = n['carbohydrates_100g'];
  const fat = n['fat_100g'];
  if (kcalRaw === null || !finite(protein) || !finite(carb) || !finite(fat)) return null;
  if ([kcalRaw, protein, carb, fat].some((v) => v < 0)) return null;

  // Plausibilidade: 100 g não passam de ~900 kcal nem de 100 g de macros, e as kcal batem com os macros
  // (fibra e álcool explicam diferenças pequenas).
  if (kcalRaw > 900 || protein + carb + fat > 100.5) return null;
  const fromMacros = 4 * protein + 4 * carb + 9 * fat;
  if (Math.abs(kcalRaw - fromMacros) > Math.max(50, 0.4 * kcalRaw)) return null;

  const tag = Array.isArray(p.categories_tags) && p.categories_tags.length > 0 ? String(p.categories_tags[0]) : '';
  return {
    barcode,
    name,
    category: tag ? tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ') : null,
    kcalPer100g: round2(kcalRaw),
    proteinPer100g: round2(protein),
    carbPer100g: round2(carb),
    fatPer100g: round2(fat),
  };
}

export async function offFetch(path: string, timeoutMs = 10_000): Promise<Response> {
  return fetch(`${OFF_BASE}${path}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
}

/** Busca um produto pelo código de barras no Open Food Facts. null = não existe ou dados incompletos. */
export async function fetchOffProduct(barcode: string): Promise<OffFood | null> {
  try {
    const res = await offFetch(`/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}`, 8_000);
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: number; product?: unknown };
    return body.status === 1 ? mapOffProduct(body.product) : null;
  } catch {
    return null;
  }
}

/** Grava (ou atualiza) o produto em foods; idempotente por código de barras. Devolve o id. */
export async function upsertOffFood(f: OffFood, db: Pick<PoolClient, 'query'> = pool): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO foods (name, source, external_id, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, barcode)
     VALUES ($1, 'openfoodfacts', $2, $3, $4, $5, $6, $7, $2)
     ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, kcal_per_100g = EXCLUDED.kcal_per_100g,
                   protein_per_100g = EXCLUDED.protein_per_100g, carb_per_100g = EXCLUDED.carb_per_100g,
                   fat_per_100g = EXCLUDED.fat_per_100g
     RETURNING id`,
    [f.name, f.barcode, f.category, f.kcalPer100g, f.proteinPer100g, f.carbPer100g, f.fatPer100g],
  );
  return rows[0].id;
}
