import { pool } from '../../database/pool';
import type { OnboardingLogger } from './onboarding.log';

export interface CtxFood {
  id: string;
  name: string;
  source: string;
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
}

export interface FoodContext {
  /** Alimentos que a pessoa disse gostar, já casados com a TACO (food = null quando não achou). */
  favorites: { typed: string; food: CtxFood | null }[];
  /** Os 10 alimentos mais registrados no log de comida. */
  topConsumed: (CtxFood & { count: number })[];
  /** Base de alimentos comuns (TACO) para a IA montar o plano alimentar. */
  staples: CtxFood[];
}

const COLS = 'id, name, source, kcal_per_100g AS kcal, protein_per_100g AS protein, carb_per_100g AS carb, fat_per_100g AS fat';

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'em', 'e', 'ao', 'na', 'no']);

// Termos comuns -> alimento preferido da TACO (a busca por palavras sozinha cai em "coração de frango", "feijão broto cru"...).
const ALIASES: Record<string, string> = {
  arroz: 'Arroz, tipo 1, cozido',
  'arroz branco': 'Arroz, tipo 1, cozido',
  'arroz integral': 'Arroz, integral, cozido',
  feijao: 'Feijão, carioca, cozido',
  'feijao carioca': 'Feijão, carioca, cozido',
  'feijao preto': 'Feijão, preto, cozido',
  frango: 'Frango, peito, sem pele, grelhado',
  'frango grelhado': 'Frango, peito, sem pele, grelhado',
  'peito de frango': 'Frango, peito, sem pele, grelhado',
  ovo: 'Ovo, de galinha, inteiro, cozido/10minutos',
  ovos: 'Ovo, de galinha, inteiro, cozido/10minutos',
  'ovo cozido': 'Ovo, de galinha, inteiro, cozido/10minutos',
  'batata doce': 'Batata, doce, cozida',
  batata: 'Batata, inglesa, cozida',
  mandioca: 'Mandioca, cozida',
  aipim: 'Mandioca, cozida',
  macaxeira: 'Mandioca, cozida',
  carne: 'Carne, bovina, patinho, sem gordura, grelhado',
  'carne moida': 'Carne, bovina, acém, moído, cozido',
  aveia: 'Aveia, flocos, crua',
  banana: 'Banana, prata, crua',
  iogurte: 'Iogurte, natural',
  pao: 'Pão, trigo, francês',
};

const toRow = (r: Record<string, unknown>): CtxFood => ({
  id: r.id as string,
  name: r.name as string,
  source: r.source as string,
  kcal: Number(r.kcal),
  protein: Number(r.protein),
  carb: Number(r.carb),
  fat: Number(r.fat),
});

async function byNamePrefix(name: string): Promise<CtxFood | null> {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM foods WHERE source = 'taco' AND name ILIKE $1 ORDER BY length(name) LIMIT 1`,
    [`${name.replace(/[\\%_]/g, '\\$&')}%`],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Todas as palavras precisam casar (sem acento); prefere versão preparada (cozido/grelhado), e "cru" para frutas e leite. */
async function byTokens(text: string): Promise<CtxFood | null> {
  const tokens = strip(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
  if (tokens.length === 0) return null;
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM foods
     WHERE source = 'taco' AND NOT EXISTS (SELECT 1 FROM unnest($1::text[]) t WHERE name_search NOT LIKE '%' || t || '%')
     ORDER BY (CASE WHEN category ILIKE 'Fruta%' OR category ILIKE 'Leite%' THEN name_search ~ 'cru'
                    ELSE name_search ~ 'cozid|grelhad|assad' END) DESC, length(name)
     LIMIT 1`,
    [tokens],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function findTacoFood(term: string): Promise<CtxFood | null> {
  const alias = ALIASES[strip(term).trim()];
  return (alias ? await byNamePrefix(alias) : null) ?? byTokens(term);
}

// Base de alimentos comuns para o plano alimentar: nome exato da TACO (prefixo) ou busca por palavras.
const STAPLES: (string | string[])[] = [
  'Arroz, tipo 1, cozido', 'Arroz, integral, cozido', 'Feijão, carioca, cozido', 'Feijão, preto, cozido', 'Lentilha, cozida',
  'Grão-de-bico, cru', 'Frango, peito, sem pele, grelhado', 'Carne, bovina, patinho, sem gordura, grelhado',
  'Carne, bovina, acém, moído, cozido', 'Ovo, de galinha, inteiro, cozido/10minutos', 'Sardinha, assada', 'Atum, conserva em óleo',
  ['tilapia'], 'Batata, doce, cozida', 'Batata, inglesa, cozida', 'Mandioca, cozida', ['macarrao', 'cozido'], 'Pão, trigo, francês',
  ['pao', 'integral'], 'Aveia, flocos, crua', 'Banana, prata, crua', 'Maçã, Fuji, com casca, crua', 'Laranja, pêra, crua',
  'Mamão, Papaia, cru', 'Iogurte, natural', 'Queijo, minas, frescal', 'Azeite, de oliva, extra virgem', 'Amendoim, grão, cru',
  'Brócolis, cozido', 'Alface, crespa, crua', 'Tomate, com semente, cru', 'Cenoura, cozida', 'Soja, extrato solúvel, natural, fluido',
];

/** Favoritos, mais consumidos e base de alimentos, tudo com nutrientes por 100 g vindos do banco. */
export async function loadFoodContext(userId: string, favoriteNames: string[], log: OnboardingLogger): Promise<FoodContext> {
  const favorites = await Promise.all(favoriteNames.map(async (typed) => ({ typed, food: await findTacoFood(typed) })));
  for (const f of favorites) {
    if (f.food) log.debug(`favorito "${f.typed}" -> ${f.food.name}`);
    else log.warn(`favorito "${f.typed}" não encontrado na TACO; ignorado`);
  }

  const { rows: top } = await pool.query(
    `SELECT ${COLS.split(', ').map((c) => `f.${c}`).join(', ')}, count(*)::int AS count
     FROM food_logs l JOIN foods f ON f.id = l.food_id
     WHERE l.user_id = $1 GROUP BY f.id ORDER BY count DESC, f.name LIMIT 10`,
    [userId],
  );
  const topConsumed = top.map((r) => ({ ...toRow(r), count: r.count as number }));
  if (topConsumed.length === 0) log.info('sem histórico de alimentos consumidos (usuário novo)');

  const staples = (await Promise.all(STAPLES.map((s) => (typeof s === 'string' ? byNamePrefix(s) : byTokens(s.join(' ')))))).filter(
    (f): f is CtxFood => f !== null,
  );
  return { favorites, topConsumed, staples };
}
