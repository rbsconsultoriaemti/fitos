/**
 * Catálogo de preferências alimentares (gosto / não gosto / indiferente) do questionário do onboarding.
 *
 * - `key`: identificador estável em snake_case (é o que o banco guarda; nunca renomear depois de publicado).
 * - `label`: como o aluno falaria, em português do Brasil.
 * - `searchTerms`: cada termo é uma lista de palavras, sem acento e em minúsculas, que devem aparecer TODAS em
 *   `foods.name_search` (mesmo critério da busca). O item casa com a TACO se algum termo casar com algum alimento.
 * - `taco`: `true` se há correspondência na TACO; `false` mantém o item na lista, mas ele não prioriza nada na busca.
 *   `npm run check:food-catalog` confere este campo contra o banco.
 */
export type FoodCategory =
  | 'proteinas'
  | 'carboidratos'
  | 'legumes_verduras'
  | 'frutas'
  | 'laticinios_ovos'
  | 'bebidas'
  | 'lanches_snacks'
  | 'pratos_brasileiros';

export interface FoodCatalogItem {
  key: string;
  label: string;
  category: FoodCategory;
  searchTerms: string[];
  taco: boolean;
}

export const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  proteinas: 'Proteínas',
  carboidratos: 'Carboidratos',
  legumes_verduras: 'Legumes e verduras',
  frutas: 'Frutas',
  laticinios_ovos: 'Laticínios e ovos',
  bebidas: 'Bebidas',
  lanches_snacks: 'Lanches e snacks',
  pratos_brasileiros: 'Pratos brasileiros',
};

const item = (key: string, label: string, category: FoodCategory, searchTerms: string[], taco = true): FoodCatalogItem => ({ key, label, category, searchTerms, taco });

const P = 'proteinas' as const;
const C = 'carboidratos' as const;
const L = 'legumes_verduras' as const;
const F = 'frutas' as const;
const D = 'laticinios_ovos' as const;
const B = 'bebidas' as const;
const S = 'lanches_snacks' as const;
const R = 'pratos_brasileiros' as const;

export const FOOD_CATALOG: FoodCatalogItem[] = [
  // ---- Proteínas ----
  item('frango_grelhado', 'Frango grelhado', P, ['frango peito grelhado']),
  item('frango_cozido', 'Frango cozido / desfiado', P, ['frango peito cozido']),
  item('frango_frito', 'Frango frito', P, [], false),
  item('coxa_sobrecoxa', 'Coxa e sobrecoxa de frango', P, ['frango coxa', 'frango sobrecoxa']),
  item('carne_moida', 'Carne moída', P, ['carne bovina moido']),
  item('patinho', 'Patinho', P, ['patinho']),
  item('alcatra', 'Alcatra', P, ['alcatra']),
  item('contrafile', 'Contrafilé', P, ['contra file']),
  item('picanha', 'Picanha', P, ['picanha']),
  item('costela_bovina', 'Costela', P, ['costela']),
  item('bacon', 'Bacon', P, [], false),
  item('linguica', 'Linguiça', P, ['linguica']),
  item('presunto', 'Presunto', P, ['presunto']),
  item('peito_peru', 'Peito de peru', P, ['peru']),
  item('salmao', 'Salmão', P, ['salmao']),
  item('tilapia', 'Tilápia', P, [], false),
  item('atum', 'Atum', P, ['atum']),
  item('sardinha', 'Sardinha', P, ['sardinha']),
  item('camarao', 'Camarão', P, ['camarao']),
  item('tofu', 'Tofu', P, [], false),
  item('whey_protein', 'Whey protein', P, [], false),

  // ---- Carboidratos ----
  item('arroz_branco', 'Arroz branco', C, ['arroz cozido']),
  item('arroz_integral', 'Arroz integral', C, ['arroz integral cozido']),
  item('macarrao', 'Macarrão', C, ['macarrao trigo']),
  item('batata_cozida', 'Batata cozida', C, ['batata inglesa cozida']),
  item('batata_frita', 'Batata frita', C, ['batata frita']),
  item('batata_doce', 'Batata-doce', C, ['batata doce cozida']),
  item('mandioca', 'Mandioca / aipim', C, ['mandioca cozida']),
  item('inhame', 'Inhame', C, ['inhame']),
  item('cuscuz', 'Cuscuz', C, ['cuscuz']),
  item('tapioca', 'Tapioca', C, ['tapioca', 'goma tapioca']),
  item('pao_frances', 'Pão francês', C, ['pao frances']),
  item('pao_forma', 'Pão de forma', C, ['pao forma']),
  item('pao_integral', 'Pão integral', C, ['pao integral']),
  item('aveia', 'Aveia', C, ['aveia']),
  item('milho_verde', 'Milho verde', C, ['milho verde']),
  item('feijao_carioca', 'Feijão carioca', C, ['feijao carioca cozido']),
  item('feijao_preto', 'Feijão preto', C, ['feijao preto cozido']),
  item('lentilha', 'Lentilha', C, ['lentilha']),
  item('grao_de_bico', 'Grão-de-bico', C, ['grao de bico']),
  item('farofa', 'Farofa', C, ['farofa']),
  item('granola', 'Granola', C, ['granola'], false),

  // ---- Legumes e verduras ----
  item('alface', 'Alface', L, ['alface']),
  item('tomate', 'Tomate', L, ['tomate cru']),
  item('cenoura', 'Cenoura', L, ['cenoura']),
  item('pepino', 'Pepino', L, ['pepino']),
  item('brocolis', 'Brócolis', L, ['brocolis']),
  item('couve_flor', 'Couve-flor', L, ['couve flor']),
  item('couve_manteiga', 'Couve', L, ['couve manteiga']),
  item('espinafre', 'Espinafre', L, ['espinafre']),
  item('rucula', 'Rúcula', L, ['rucula']),
  item('repolho', 'Repolho', L, ['repolho']),
  item('abobrinha', 'Abobrinha', L, ['abobrinha']),
  item('abobora', 'Abóbora', L, ['abobora']),
  item('beterraba', 'Beterraba', L, ['beterraba']),
  item('chuchu', 'Chuchu', L, ['chuchu']),
  item('berinjela', 'Berinjela', L, ['berinjela']),
  item('vagem', 'Vagem', L, ['vagem']),
  item('quiabo', 'Quiabo', L, ['quiabo']),
  item('pimentao', 'Pimentão', L, ['pimentao']),
  item('cebola', 'Cebola', L, ['cebola']),
  item('alho', 'Alho', L, ['alho']),
  item('cogumelo', 'Cogumelo', L, [], false),
  item('palmito', 'Palmito', L, ['palmito']),

  // ---- Frutas ----
  item('banana', 'Banana', F, ['banana']),
  item('maca', 'Maçã', F, ['maca']),
  item('laranja', 'Laranja', F, ['laranja pera cru', 'laranja']),
  item('mamao', 'Mamão', F, ['mamao']),
  item('melancia', 'Melancia', F, ['melancia']),
  item('melao', 'Melão', F, ['melao']),
  item('abacaxi', 'Abacaxi', F, ['abacaxi']),
  item('manga', 'Manga', F, ['manga']),
  item('uva', 'Uva', F, ['uva']),
  item('morango', 'Morango', F, ['morango']),
  item('abacate', 'Abacate', F, ['abacate']),
  item('pera', 'Pera', F, ['pera']),
  item('kiwi', 'Kiwi', F, ['kiwi']),
  item('goiaba', 'Goiaba', F, ['goiaba']),
  item('limao', 'Limão', F, ['limao']),
  item('tangerina', 'Tangerina / mexerica', F, ['tangerina']),
  item('maracuja', 'Maracujá', F, ['maracuja']),
  item('acai', 'Açaí', F, ['acai']),
  item('coco', 'Coco', F, ['coco']),

  // ---- Laticínios e ovos ----
  item('ovo_cozido', 'Ovo cozido', D, ['ovo galinha cozido']),
  item('ovo_mexido', 'Ovo mexido', D, [], false),
  item('omelete', 'Omelete', D, ['omelete']),
  item('leite_integral', 'Leite integral', D, ['leite vaca integral']),
  item('leite_desnatado', 'Leite desnatado', D, ['leite vaca desnatado']),
  item('iogurte_natural', 'Iogurte natural', D, ['iogurte natural']),
  item('iogurte_grego', 'Iogurte grego', D, ['iogurte grego'], false),
  item('queijo_minas', 'Queijo minas', D, ['queijo minas']),
  item('queijo_mussarela', 'Queijo muçarela', D, ['queijo mozarela']),
  item('queijo_prato', 'Queijo prato', D, ['queijo prato']),
  item('requeijao', 'Requeijão', D, [], false),
  item('ricota', 'Ricota', D, ['ricota']),
  item('queijo_cottage', 'Queijo cottage', D, ['cottage'], false),
  item('manteiga', 'Manteiga', D, ['manteiga']),

  // ---- Bebidas ----
  item('cafe', 'Café', B, ['cafe infusao']),
  item('cafe_com_leite', 'Café com leite', B, [], false),
  item('cha', 'Chá', B, ['cha']),
  item('cha_mate', 'Chá mate', B, ['cha mate']),
  item('suco_laranja', 'Suco de laranja', B, ['suco laranja']),
  item('suco_uva', 'Suco de uva', B, ['suco uva']),
  item('agua_de_coco', 'Água de coco', B, ['agua coco']),
  item('refrigerante', 'Refrigerante', B, ['refrigerante']),
  item('refrigerante_zero', 'Refrigerante zero', B, ['refrigerante zero'], false),
  item('cerveja', 'Cerveja', B, ['cerveja']),
  item('vinho', 'Vinho', B, [], false),
  item('achocolatado', 'Achocolatado', B, ['achocolatado']),
  item('vitamina_frutas', 'Vitamina de frutas', B, ['vitamina']),

  // ---- Lanches e snacks ----
  item('chocolate_ao_leite', 'Chocolate ao leite', S, ['chocolate leite']),
  item('chocolate_amargo', 'Chocolate amargo', S, ['chocolate amargo']),
  item('sorvete', 'Sorvete', S, [], false),
  item('bolo', 'Bolo', S, ['bolo']),
  item('biscoito_recheado', 'Biscoito recheado', S, ['biscoito recheado']),
  item('biscoito_salgado', 'Biscoito salgado (cream cracker)', S, ['biscoito salgado']),
  item('pipoca', 'Pipoca', S, ['pipoca']),
  item('amendoim', 'Amendoim', S, ['amendoim']),
  item('castanha_caju', 'Castanha-de-caju', S, ['castanha caju']),
  item('castanha_do_para', 'Castanha-do-pará', S, ['castanha para']),
  item('barra_cereal', 'Barra de cereal', S, [], false),
  item('pizza', 'Pizza', S, [], false),
  item('pao_de_queijo', 'Pão de queijo', S, ['pao queijo']),
  item('coxinha', 'Coxinha', S, ['coxinha']),
  item('pastel', 'Pastel', S, ['pastel']),
  item('brigadeiro', 'Brigadeiro', S, [], false),
  item('doce_de_leite', 'Doce de leite', S, ['doce leite']),
  item('mel', 'Mel', S, ['mel']),
  item('pasta_de_amendoim', 'Pasta de amendoim', S, ['pasta amendoim'], false),

  // ---- Pratos brasileiros ----
  item('feijoada', 'Feijoada', R, ['feijoada']),
  item('strogonoff_carne', 'Strogonoff de carne', R, ['estrogonofe carne']),
  item('strogonoff_frango', 'Strogonoff de frango', R, ['estrogonofe frango']),
  item('lasanha', 'Lasanha', R, ['lasanha']),
  item('moqueca', 'Moqueca de peixe', R, [], false),
  item('baiao_de_dois', 'Baião de dois', R, ['baiao']),
  item('arroz_carreteiro', 'Arroz carreteiro', R, ['carreteiro']),
  item('galinhada', 'Galinhada', R, [], false),
  item('feijao_tropeiro', 'Feijão tropeiro', R, ['tropeiro']),
  item('picadinho', 'Picadinho de carne', R, [], false),
  item('almondega', 'Almôndega', R, ['almondegas']),
  item('quibe', 'Quibe', R, ['quibe']),
  item('salpicao', 'Salpicão', R, ['salpicao']),
  item('maionese_batata', 'Maionese de batata', R, ['maionese']),
  item('pure_batata', 'Purê de batata', R, [], false),
  item('sopa_legumes', 'Sopa de legumes', R, [], false),
  item('escondidinho', 'Escondidinho', R, ['escondidinho'], false),
  item('acaraje', 'Acarajé', R, ['acaraje']),
  item('virado_paulista', 'Virado à paulista', R, ['virado paulista']),
  item('torta_frango', 'Torta de frango', R, [], false),
  item('prato_feito', 'Prato feito (arroz, feijão, bife e salada)', R, [], false),
];

export const FOOD_CATALOG_KEYS = new Set(FOOD_CATALOG.map((i) => i.key));
