-- Porções caseiras para alimentos comuns da TACO (foods.portions = [{"label": ..., "grams": ...}]).
--
-- ATENÇÃO: a TACO não traz medidas caseiras. Estes valores são ESTIMATIVAS usuais de medidas
-- (referências de rotulagem da ANVISA e senso comum), não dados oficiais da TACO. Líquidos: 1 ml ≈ 1 g.
-- A fonte adequada para uma versão completa é a "Tabela de Medidas Referidas" da POF/IBGE.
-- Nutricionista/admin ajustam por alimento via PATCH /nutrition/foods/:id/portions.
--
-- Idempotente: reexecutar reaplica os mesmos valores. Uso: npm run seed:portions

UPDATE foods SET portions = '[{"label":"fatia","grams":25}]'::jsonb
 WHERE source = 'taco' AND name IN ('Pão, trigo, forma, integral', 'Pão, milho, forma', 'Pão, glúten, forma', 'Pão, aveia, forma');

UPDATE foods SET portions = '[{"label":"unidade","grams":50}]'::jsonb
 WHERE source = 'taco' AND name IN ('Pão, trigo, francês', 'Ovo, de galinha, inteiro, cozido/10minutos', 'Ovo, de galinha, inteiro, cru');

UPDATE foods SET portions = '[{"label":"unidade","grams":10}]'::jsonb
 WHERE source = 'taco' AND name = 'Ovo, de codorna, inteiro, cru';

UPDATE foods SET portions = '[{"label":"fatia","grams":15}]'::jsonb
 WHERE source = 'taco' AND name IN ('Queijo, mozarela', 'Queijo, prato', 'Presunto, com capa de gordura', 'Presunto, sem capa de gordura');

UPDATE foods SET portions = '[{"label":"colher de sobremesa","grams":10}]'::jsonb
 WHERE source = 'taco' AND name IN ('Manteiga, com sal', 'Manteiga, sem sal');

UPDATE foods SET portions = '[{"label":"colher de sopa","grams":12}]'::jsonb
 WHERE source = 'taco' AND name IN ('Azeite, de oliva, extra virgem', 'Óleo, de soja', 'Óleo, de girassol', 'Óleo, de milho', 'Óleo, de canola');

UPDATE foods SET portions = '[{"label":"colher de chá","grams":5}]'::jsonb
 WHERE source = 'taco' AND name IN ('Açúcar, refinado', 'Açúcar, cristal');

UPDATE foods SET portions = '[{"label":"colher de sopa","grams":21}]'::jsonb
 WHERE source = 'taco' AND name = 'Mel, de abelha';

UPDATE foods SET portions = '[{"label":"colher de sopa","grams":10}]'::jsonb
 WHERE source = 'taco' AND name = 'Aveia, flocos, crua';

UPDATE foods SET portions = '[{"label":"colher de sopa","grams":25}]'::jsonb
 WHERE source = 'taco' AND name IN ('Arroz, integral, cozido', 'Arroz, tipo 1, cozido', 'Arroz, tipo 2, cozido');

-- Bebidas não alcoólicas e sucos prontos: copo (200 ml) e xícara (240 ml).
UPDATE foods SET portions = '[{"label":"copo","grams":200},{"label":"xícara","grams":240}]'::jsonb
 WHERE source = 'taco' AND name IN (
   'Bebida isotônica, sabores variados', 'Cana, caldo de', 'Chá, erva-doce, infusão 5%', 'Chá, mate, infusão 5%',
   'Chá, preto, infusão 5%', 'Coco, água de', 'Refrigerante, tipo água tônica', 'Refrigerante, tipo cola',
   'Refrigerante, tipo guaraná', 'Refrigerante, tipo laranja', 'Refrigerante, tipo limão',
   'Laranja, baía, suco', 'Laranja, da terra, suco', 'Laranja, lima, suco', 'Laranja, pêra, suco',
   'Laranja, valência, suco', 'Tangerina, Poncã, suco');

UPDATE foods SET portions = '[{"label":"xícara de café","grams":50},{"label":"xícara","grams":240}]'::jsonb
 WHERE source = 'taco' AND name = 'Café, infusão 10%';
