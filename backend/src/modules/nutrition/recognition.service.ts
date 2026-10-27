import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { displayFoodName } from '../../shared/food-name';
import { loadPreferences, sortByPreference, type Preferences } from '../preferences/preferences.service';

interface RecognizedFood {
  name: string;
  quantity_g: number;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  confidence: number;
}

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'em', 'ao', 'na', 'no', 'e']);

const escapeLike = (s: string) => s.replace(/[\%_]/g, '\$&');

/** Alimentos candidatos para um nome livre: ranqueados pelo nº de palavras que casam. */
async function findCandidates(name: string, prefs: Preferences | null) {
  const tokens = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (tokens.length === 0) return [];

  const patterns = tokens.map((t) => `%${escapeLike(t)}%`);
  const { rows } = await pool.query(
    `SELECT id, name, source, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, score
     FROM (
       SELECT f.*, (SELECT count(*) FROM unnest($1::text[]) p WHERE f.name ILIKE p) AS score FROM foods f
     ) s
     WHERE score > 0
     ORDER BY score DESC, (lower(name) LIKE $2) DESC, length(name)
     LIMIT 5`,
    [patterns, `${escapeLike(tokens[0])}%`],
  );
  return sortByPreference(rows, prefs, (r) => r.name as string).map((r) => ({
    foodId: r.id,
    name: r.name,
    displayName: displayFoodName(r.name, r.source, r.category),
    source: r.source,
    kcalPer100g: Number(r.kcal_per_100g),
    proteinPer100g: Number(r.protein_per_100g),
    carbPer100g: Number(r.carb_per_100g),
    fatPer100g: Number(r.fat_per_100g),
  }));
}

/**
 * Envia a foto ao ai-service (Claude Vision) e casa cada alimento reconhecido com o banco.
 * Nada é registrado aqui: o aluno confirma/corrige e então chama POST /nutrition/logs.
 */
export async function recognizeMeal(image: Buffer, mimeType: string, hints?: string, userId?: string) {
  if (!config.aiService.token) {
    throw new AppError(503, 'ai_unavailable', 'Reconhecimento por foto não configurado');
  }

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(image)], { type: mimeType }), 'meal');
  if (hints) form.append('hints', hints);

  let res: Response;
  try {
    res = await fetch(`${config.aiService.url}/vision/food-recognition`, {
      method: 'POST',
      headers: { 'X-Service-Token': config.aiService.token },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AppError(503, 'ai_unavailable', 'Serviço de reconhecimento indisponível');
  }
  if (!res.ok) {
    throw new AppError(res.status === 503 ? 503 : 502, 'ai_error', 'Falha ao reconhecer a refeição');
  }

  const { foods } = (await res.json()) as { foods: RecognizedFood[] };
  // `estimated` são os macros que o Claude calculou para a porção; serve de fallback quando nenhum candidato da TACO serve.
  const prefs = userId ? await loadPreferences(userId) : null;
  const matched = await Promise.all(
    foods.map(async (f) => ({
      recognized: {
        name: f.name,
        estimatedGrams: f.quantity_g,
        confidence: f.confidence,
        estimated: { kcal: f.kcal, proteinG: f.protein_g, carbG: f.carb_g, fatG: f.fat_g },
      },
      candidates: await findCandidates(f.name, prefs),
    })),
  );

  return {
    items: matched,
    disclaimer: 'Estimativa automática por IA. Confira os alimentos e as quantidades antes de registrar.',
  };
}
