import fs from 'fs';
import path from 'path';
import { pool } from '../pool';

interface TacoFood {
  tacoId: number;
  name: string;
  category: string;
  kcal: number | null;
  protein: number | null;
  carb: number | null;
  fat: number | null;
}

type Override = Partial<Pick<TacoFood, 'kcal' | 'protein' | 'carb' | 'fat'>>;

// Fonte: TACO 4ª ed. (NEPA/UNICAMP, 2011). Ver data/build-taco.mjs para como o JSON foi gerado.
async function main() {
  const dir = path.resolve(__dirname, '../../../data');
  const all: TacoFood[] = JSON.parse(fs.readFileSync(path.join(dir, 'taco.json'), 'utf8'));
  // Linhas que chegam sem macros no levantamento (ex.: leite integral) recebem valores de data/taco-overrides.json.
  const overrides: Record<string, Override> = JSON.parse(fs.readFileSync(path.join(dir, 'taco-overrides.json'), 'utf8'));
  const filled = all.map((f) => {
    const o = overrides[String(f.tacoId)];
    return o ? { ...f, kcal: f.kcal ?? o.kcal ?? null, protein: f.protein ?? o.protein ?? null, carb: f.carb ?? o.carb ?? null, fat: f.fat ?? o.fat ?? null } : f;
  });
  const foods = filled.filter((f) => [f.kcal, f.protein, f.carb, f.fat].every((v) => v !== null));

  for (const f of foods) {
    await pool.query(
      `INSERT INTO foods (name, source, external_id, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g)
       VALUES ($1, 'taco', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
         kcal_per_100g = EXCLUDED.kcal_per_100g, protein_per_100g = EXCLUDED.protein_per_100g,
         carb_per_100g = EXCLUDED.carb_per_100g, fat_per_100g = EXCLUDED.fat_per_100g`,
      [f.name, String(f.tacoId), f.category, f.kcal, f.protein, f.carb, f.fat],
    );
  }
  console.log(`TACO: ${foods.length} alimentos importados, ${all.length - foods.length} ignorados (sem dados de macros).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
