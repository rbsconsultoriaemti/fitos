/**
 * Nomes de cardápio para os alimentos da TACO ("Frango, peito, sem pele, grelhado" -> "Frango grelhado").
 * É só apresentação: o nome original continua no banco e é o que a busca usa.
 */

const STATE_RE = /^(cru|crua|crus|cruas|cozid[oa]s?|grelhad[oa]s?|assad[oa]s?|frit[oa]s?|refogad[oa]s?)$/i;
const RAW_RE = /^cru/i;

/** Qualificadores que só descrevem o padrão e não mudam o que a pessoa come. */
const NOISE = new Set(['sem pele', 'sem gordura', 'tipo 1', 'de galinha', 'de vaca', 'bovina', 'fluido', 'com semente', 'fresco', 'fresca']);
/** Variedade padrão que some do nome: só para o alimento indicado ("Alface, crespa" -> "Alface"). */
const DEFAULT_VARIETY: Record<string, string> = { alface: 'crespa', batata: 'inglesa', pao: 'trigo', macarrao: 'trigo' };
/** Cortes de frango que viram "Coxa de frango"; o peito (e o frango inteiro) é só "Frango". */
const CHICKEN_CUTS = new Set(['coxa', 'sobrecoxa', 'asa', 'coração', 'fígado', 'filé']);
/** Verduras que se come cruas (salada): nelas o "cru" some. Nas demais verduras o estado fica. */
const RAW_OK_VEGETABLES = new Set([
  'alface', 'tomate', 'pepino', 'cenoura', 'beterraba', 'repolho', 'rúcula', 'agrião', 'acelga', 'almeirão', 'cebola',
  'cebolinha', 'pimentão', 'rabanete', 'salsa', 'coentro', 'manjericão', 'chicória', 'aipo', 'couve', 'alfavaca', 'maxixe',
]);

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isFruitOrNut = (category?: string | null) => !!category && /^(fruta|nozes)/i.test(category);

/** Fruta/castanha e verdura de salada perdem o "cru"; carnes, peixes, ovos, cereais, feijões e tubérculos o mantêm. */
function rawIsRedundant(head: string, category?: string | null) {
  if (isFruitOrNut(category)) return true;
  return !!category && /^verduras/i.test(category) && RAW_OK_VEGETABLES.has(norm(head));
}

/**
 * @param name     nome como está na TACO
 * @param category categoria TACO; decide se o estado "cru" pode sumir (fruta, salada) ou precisa ficar (frango cru)
 */
export function formatFoodName(name: string, category?: string | null): string {
  const parts = name
    .split(',')
    .map((p) => p.trim().replace(/\/.*$/, '').replace(/\s+/g, ' ')) // "cozido/10minutos" -> "cozido"
    .filter(Boolean);
  if (parts.length === 0) return name.trim();
  if (parts.length === 1) return upperFirst(parts[0]);

  let head = parts[0];
  let mods = parts.slice(1);
  const headKey = norm(head);
  const lower = (i: number) => mods[i]?.toLowerCase();

  // Carne, bovina, patinho, ... -> o corte vira o nome
  if (headKey === 'carne' && lower(0) === 'bovina') {
    mods = mods.slice(1);
    const cut = mods.shift()!;
    if (cut.toLowerCase() === 'seca') head = 'Carne seca';
    else if (cut.toLowerCase() === 'peito') head = 'Peito bovino';
    else head = cut;
  } else if (headKey === 'porco' && mods.length > 0) {
    head = `${upperFirst(mods.shift()!)} de porco`; // Porco, bisteca -> Bisteca de porco
  } else if (headKey === 'frango' && mods.length > 0) {
    const first = lower(0)!;
    if (CHICKEN_CUTS.has(first)) head = `${upperFirst(mods.shift()!)} de frango`;
    else if (first === 'peito') mods.shift();
  } else if (headKey === 'ovo' && mods.length > 0) {
    mods = mods.filter((m) => !['inteiro', 'de galinha'].includes(m.toLowerCase()));
    if (['clara', 'gema'].includes(lower(0)!) ) head = `${upperFirst(mods.shift()!)} de ovo`;
  } else if (headKey === 'linguica') {
    if (mods.length > 0 && !STATE_RE.test(mods[0])) mods[0] = `de ${mods[0]}`;
  } else if (headKey === 'pao' && mods.some((m) => m.toLowerCase() === 'forma')) {
    mods = mods.filter((m) => m.toLowerCase() !== 'forma');
    head = 'Pão de forma';
    mods = mods.map((m) => (['aveia', 'glúten', 'milho', 'soja'].includes(m.toLowerCase()) ? `de ${m}` : m));
  }

  const dropVariety = DEFAULT_VARIETY[headKey];
  const dropRaw = rawIsRedundant(parts[0], category);
  const out: string[] = [];
  let juice = false;
  for (const m of mods) {
    const key = m.toLowerCase();
    if (NOISE.has(key) || key === dropVariety) continue;
    if (key === 'suco') {
      juice = true;
      continue;
    }
    if (RAW_RE.test(key) && STATE_RE.test(key) && dropRaw) continue;
    out.push(key === 'pó' ? 'em pó' : m);
  }

  const text = [head, ...out].join(' ');
  return upperFirst(juice ? `Suco de ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);
}

/** Só a TACO tem nomes técnicos; produtos de marca (Open Food Facts) e alimentos criados pelo usuário ficam como estão. */
export function displayFoodName(name: string, source?: string | null, category?: string | null): string {
  return source === 'taco' ? formatFoodName(name, category) : name;
}

/**
 * Ordem na busca: 0 = preparado (cozido, grelhado, assado, frito, refogado), 1 = sem estado ou que se come cru
 * (frutas, saladas), 2 = cru que ninguém registra assim (carne, arroz, feijão...).
 */
export function foodStateRank(name: string, source?: string | null, category?: string | null): number {
  if (source !== 'taco') return 1;
  const parts = name.split(',').map((p) => p.trim().replace(/\/.*$/, ''));
  if (parts.some((p) => /^(cozid|grelhad|assad|frit|refogad)/i.test(p))) return 0;
  if (parts.some((p) => RAW_RE.test(p))) return rawIsRedundant(parts[0], category) ? 1 : 2;
  return 1;
}
