import fs from 'fs';
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// "Tr" (traço) = 0. "NA" (não aplicável) = 0 se a energia foi medida. "*" (não analisado) e "" = sem dado → null.
const val = (v, energyKnown) => (typeof v === 'number' ? Math.max(0, Math.round(v * 100) / 100) : v === 'Tr' || (v === 'NA' && energyKnown) ? 0 : null);
const out = rows.map((r) => ({
  tacoId: r.id,
  name: r.description.trim(),
  category: r.category,
  kcal: val(r.energy_kcal, false),
  protein: val(r.protein_g, typeof r.energy_kcal === 'number'),
  carb: val(r.carbohydrate_g, typeof r.energy_kcal === 'number'),
  fat: val(r.lipid_g, typeof r.energy_kcal === 'number'),
}));
const usable = out.filter((f) => [f.kcal, f.protein, f.carb, f.fat].every((v) => v !== null));
console.log('total', out.length, 'usable', usable.length, 'skipped', out.length - usable.length);
console.log('skipped:', out.filter((f) => !usable.includes(f)).map((f) => f.name).join(' | '));
fs.mkdirSync(process.argv[3].replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(process.argv[3], JSON.stringify(out));
