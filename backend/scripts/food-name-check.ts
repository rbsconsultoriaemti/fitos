/** Confere formatFoodName: exemplos fixos + todos os alimentos da TACO do banco (colisões e lista completa com --all). */
import 'dotenv/config';
import { Pool } from 'pg';
import { formatFoodName } from '../src/shared/food-name';

const cases: [string, string, string | null][] = [
  ['Arroz, tipo 1, cozido', 'Arroz cozido', 'Cereais e derivados'],
  ['Feijão, carioca, cozido', 'Feijão carioca cozido', 'Leguminosas e derivados'],
  ['Frango, peito, sem pele, grelhado', 'Frango grelhado', 'Carnes e derivados'],
  ['Carne, bovina, patinho, sem gordura, grelhado', 'Patinho grelhado', 'Carnes e derivados'],
  ['Ovo, de galinha, inteiro, cozido/10minutos', 'Ovo cozido', 'Ovos e derivados'],
  ['Batata, doce, cozida', 'Batata doce cozida', 'Verduras, hortaliças e derivados'],
  ['Batata, inglesa, frita', 'Batata frita', 'Verduras, hortaliças e derivados'],
  ['Alface, crespa, crua', 'Alface', 'Verduras, hortaliças e derivados'],
  ['Tomate, com semente, cru', 'Tomate', 'Verduras, hortaliças e derivados'],
  ['Banana, prata, crua', 'Banana prata', 'Frutas e derivados'],
  ['Leite, de vaca, integral, pó', 'Leite integral em pó', 'Leite e derivados'],
  ['Pão, trigo, francês', 'Pão francês', 'Cereais e derivados'],
  ['Arroz, integral, cozido', 'Arroz integral cozido', 'Cereais e derivados'],
  ['Frango, peito, sem pele, cru', 'Frango cru', 'Carnes e derivados'],
  ['Frango, coxa, sem pele, cozida', 'Coxa de frango cozida', 'Carnes e derivados'],
  ['Laranja, lima, suco', 'Suco de laranja lima', 'Frutas e derivados'],
  ['Mortadela', 'Mortadela', 'Carnes e derivados'],
];

(async () => {
  let bad = 0;
  for (const [src, want, cat] of cases) {
    const got = formatFoodName(src, cat);
    if (got !== want) bad++;
    console.log(`${got === want ? '✔' : '✘'} ${src} → ${got}${got === want ? '' : `  (esperado: ${want})`}`);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query<{ name: string; category: string }>("SELECT name, category FROM foods WHERE source='taco' ORDER BY name");
  await pool.end();
  const byDisplay = new Map<string, string[]>();
  for (const r of rows) {
    const d = formatFoodName(r.name, r.category);
    byDisplay.set(d, [...(byDisplay.get(d) ?? []), r.name]);
    if (process.argv.includes('--all')) console.log(`${r.name}  →  ${d}`);
  }
  const dup = [...byDisplay].filter(([, v]) => v.length > 1);
  console.log(`\n${rows.length} alimentos TACO, ${dup.length} nomes de cardápio repetidos`);
  for (const [d, v] of dup) console.log(`  "${d}" ← ${v.join(' | ')}`);
  process.exitCode = bad ? 1 : 0;
})();
