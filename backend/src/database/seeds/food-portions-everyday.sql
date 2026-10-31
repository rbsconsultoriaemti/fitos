-- Medidas do dia a dia (colher, concha, xícara, copo, fatia, unidade, pedaço, filé, bife, pote, punhado...)
-- para alimentos comuns da TACO. Complementa food-portions.sql (que cobre pães, óleos, açúcar, bebidas etc.).
--
-- ATENÇÃO: são ESTIMATIVAS de uso comum (pesos médios de frutas, porções servidas em casa e rótulos).
-- Não são dados oficiais. A fonte para uma versão completa é a POF/IBGE (medidas referidas).
-- Ajustes por alimento: PATCH /nutrition/foods/:id/portions (nutricionista ou admin).
--
-- Cada UPDATE substitui a lista de porções do alimento: os valores aqui já incluem as medidas anteriores.
-- Idempotente. Uso: npx tsx src/database/seeds/run-sql.ts food-portions-everyday.sql

-- Arroz e feijão (cozidos)
UPDATE foods SET portions = '[{"label":"colher de servir","grams":60},{"label":"colher de sopa","grams":25},{"label":"xícara","grams":160}]'::jsonb
 WHERE source = 'taco' AND name IN ('Arroz, tipo 1, cozido', 'Arroz, tipo 2, cozido');

UPDATE foods SET portions = '[{"label":"concha","grams":100},{"label":"colher de servir","grams":50},{"label":"xícara","grams":170}]'::jsonb
 WHERE source = 'taco' AND name IN ('Feijão, carioca, cozido', 'Feijão, preto, cozido', 'Feijão, fradinho, cozido', 'Feijão, rajado, cozido', 'Lentilha, cozida');

-- Frutas
UPDATE foods SET portions = '[{"label":"unidade","grams":100},{"label":"rodela","grams":20}]'::jsonb
 WHERE source = 'taco' AND name = 'Banana, nanica, crua';

UPDATE foods SET portions = '[{"label":"unidade","grams":60}]'::jsonb
 WHERE source = 'taco' AND name = 'Banana, prata, crua';

UPDATE foods SET portions = '[{"label":"unidade","grams":70}]'::jsonb
 WHERE source = 'taco' AND name = 'Banana, ouro, crua';

UPDATE foods SET portions = '[{"label":"unidade","grams":130},{"label":"fatia","grams":65}]'::jsonb
 WHERE source = 'taco' AND name IN ('Maçã, Fuji, com casca, crua', 'Maçã, Argentina, com casca, crua');

UPDATE foods SET portions = '[{"label":"unidade","grams":150}]'::jsonb
 WHERE source = 'taco' AND name = 'Pêra, Williams, crua';

UPDATE foods SET portions = '[{"label":"unidade","grams":150}]'::jsonb
 WHERE source = 'taco' AND name = 'Laranja, pêra, crua';

UPDATE foods SET portions = '[{"label":"unidade","grams":80}]'::jsonb
 WHERE source = 'taco' AND name = 'Mexerica, Murcote, crua';

UPDATE foods SET portions = '[{"label":"unidade","grams":100},{"label":"fatia","grams":150}]'::jsonb
 WHERE source = 'taco' AND name = 'Mamão, Papaia, cru';

UPDATE foods SET portions = '[{"label":"unidade","grams":100}]'::jsonb
 WHERE source = 'taco' AND name = 'Goiaba, vermelha, com casca, crua';

UPDATE foods SET portions = '[{"label":"fatia","grams":280},{"label":"xícara","grams":160}]'::jsonb
 WHERE source = 'taco' AND name = 'Melancia, crua';

UPDATE foods SET portions = '[{"label":"fatia","grams":100},{"label":"xícara","grams":150}]'::jsonb
 WHERE source = 'taco' AND name = 'Abacaxi, cru';

UPDATE foods SET portions = '[{"label":"unidade","grams":12},{"label":"xícara","grams":150}]'::jsonb
 WHERE source = 'taco' AND name = 'Morango, cru';

UPDATE foods SET portions = '[{"label":"xícara","grams":150}]'::jsonb
 WHERE source = 'taco' AND name = 'Uva, Itália, crua';

UPDATE foods SET portions = '[{"label":"colher de sopa","grams":15},{"label":"metade","grams":100}]'::jsonb
 WHERE source = 'taco' AND name = 'Abacate, cru';

-- Tubérculos
UPDATE foods SET portions = '[{"label":"unidade","grams":100},{"label":"colher de servir","grams":50}]'::jsonb
 WHERE source = 'taco' AND name IN ('Batata, inglesa, cozida', 'Batata, doce, cozida');

UPDATE foods SET portions = '[{"label":"pedaço","grams":100}]'::jsonb
 WHERE source = 'taco' AND name = 'Mandioca, cozida';

-- Carnes, peixes e frango (cozidos ou grelhados)
UPDATE foods SET portions = '[{"label":"filé médio","grams":100}]'::jsonb
 WHERE source = 'taco' AND name IN ('Frango, peito, sem pele, grelhado', 'Frango, peito, sem pele, cozido');

UPDATE foods SET portions = '[{"label":"coxa","grams":90}]'::jsonb
 WHERE source = 'taco' AND name = 'Frango, coxa, sem pele, cozida';

UPDATE foods SET portions = '[{"label":"bife médio","grams":100}]'::jsonb
 WHERE source = 'taco' AND name IN ('Carne, bovina, patinho, sem gordura, grelhado', 'Carne, bovina, contra-filé, sem gordura, grelhado');

UPDATE foods SET portions = '[{"label":"filé médio","grams":120}]'::jsonb
 WHERE source = 'taco' AND name = 'Salmão, sem pele, fresco, grelhado';

UPDATE foods SET portions = '[{"label":"filé médio","grams":100}]'::jsonb
 WHERE source = 'taco' AND name = 'Pescada, filé, cru';

UPDATE foods SET portions = '[{"label":"porção","grams":60}]'::jsonb
 WHERE source = 'taco' AND name = 'Atum, conserva em óleo';

UPDATE foods SET portions = '[{"label":"colher de servir","grams":60},{"label":"porção","grams":100}]'::jsonb
 WHERE source = 'taco' AND name = 'Carne, bovina, acém, moído, cozido';

-- Laticínios
UPDATE foods SET portions = '[{"label":"copo","grams":200},{"label":"xícara","grams":240}]'::jsonb
 WHERE source = 'taco' AND name = 'Leite, de vaca, integral';

UPDATE foods SET portions = '[{"label":"pote","grams":170},{"label":"copo","grams":200}]'::jsonb
 WHERE source = 'taco' AND name = 'Iogurte, natural';

UPDATE foods SET portions = '[{"label":"fatia","grams":30}]'::jsonb
 WHERE source = 'taco' AND name = 'Queijo, minas, frescal';

UPDATE foods SET portions = '[{"label":"colher de sopa","grams":20}]'::jsonb
 WHERE source = 'taco' AND name = 'Doce, de leite, cremoso';

-- Outros
UPDATE foods SET portions = '[{"label":"quadradinho","grams":5}]'::jsonb
 WHERE source = 'taco' AND name = 'Chocolate, ao leite';

UPDATE foods SET portions = '[{"label":"unidade","grams":5}]'::jsonb
 WHERE source = 'taco' AND name = 'Castanha-do-Brasil, crua';

UPDATE foods SET portions = '[{"label":"punhado","grams":30}]'::jsonb
 WHERE source = 'taco' AND name = 'Amendoim, torrado, salgado';
