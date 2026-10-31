-- Bebidas: medidas de copo e xícara para leites e bebidas da TACO, e bebidas do dia a dia que não estão na TACO
-- (cadastradas como alimentos próprios, source 'custom'). Valores por 100 ml, aproximados (ver notas).
-- Idempotente. Uso: npx tsx src/database/seeds/run-sql.ts drinks.sql

-- Leites e bebidas da TACO
UPDATE foods SET portions = '[{"label":"copo","grams":200},{"label":"xícara","grams":240}]'::jsonb
 WHERE source = 'taco' AND name IN ('Leite, de vaca, achocolatado', 'Leite, de cabra', 'Leite, fermentado', 'Soja, extrato solúvel, natural, fluido', 'Bebida láctea, pêssego');

UPDATE foods SET portions = '[{"label":"copo","grams":200},{"label":"xícara","grams":240}]'::jsonb
 WHERE source = 'taco' AND name = 'Leite, de coco';

UPDATE foods SET portions = '[{"label":"colher de sopa","grams":10},{"label":"copo","grams":200}]'::jsonb
 WHERE source = 'taco' AND name = 'Leite, de vaca, integral, pó';

-- Bebidas do dia a dia (não estão na TACO). Macros por 100 ml, estimados a partir dos ingredientes.
INSERT INTO foods (name, source, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, portions)
SELECT v.name, 'custom', 'Bebidas', v.kcal, v.protein, v.carb, v.fat, v.portions::jsonb
FROM (VALUES
  ('Café com leite, sem açúcar', 31, 1.7, 2.3, 1.7, '[{"label":"xícara","grams":200},{"label":"copo","grams":250}]'),
  ('Vitamina de banana com leite', 71, 3.0, 10.9, 2.2, '[{"label":"copo","grams":300}]'),
  ('Chá mate gelado, adoçado', 35, 0.0, 8.7, 0.0, '[{"label":"copo","grams":200},{"label":"garrafa","grams":500}]'),
  ('Água mineral', 0, 0.0, 0.0, 0.0, '[{"label":"copo","grams":200},{"label":"garrafa","grams":500}]')
) AS v(name, kcal, protein, carb, fat, portions)
WHERE NOT EXISTS (SELECT 1 FROM foods f WHERE lower(f.name) = lower(v.name));
