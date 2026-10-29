-- Lote 2: 22 bebidas e itens de café da manhã (br-dish-050 a br-dish-071), com porções
-- Valores por 100 g/ml estimados; revisar. Idempotente (ON CONFLICT DO NOTHING).
BEGIN;
INSERT INTO foods (id, name, source, external_id, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, barcode, portions)
VALUES
  (gen_random_uuid(), 'Pingado (café com leite, sem açúcar)', 'custom', 'br-dish-050', 'Alimentos preparados', 55, 2.9, 4.2, 2.9, NULL, '[{"grams": 150, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Pingado com açúcar', 'custom', 'br-dish-051', 'Alimentos preparados', 68, 2.9, 7.4, 2.9, NULL, '[{"grams": 150, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Café com leite (xícara, sem açúcar)', 'custom', 'br-dish-052', 'Alimentos preparados', 37, 1.9, 2.8, 2.0, NULL, '[{"grams": 200, "label": "xícara"}]'::jsonb),
  (gen_random_uuid(), 'Café com leite com açúcar (xícara)', 'custom', 'br-dish-053', 'Alimentos preparados', 57, 1.9, 7.8, 2.0, NULL, '[{"grams": 200, "label": "xícara"}]'::jsonb),
  (gen_random_uuid(), 'Cafezinho sem açúcar', 'custom', 'br-dish-054', 'Alimentos preparados', 2, 0.1, 0.3, 0.0, NULL, '[{"grams": 50, "label": "xícara"}]'::jsonb),
  (gen_random_uuid(), 'Cafezinho com açúcar', 'custom', 'br-dish-055', 'Alimentos preparados', 42, 0.1, 10.3, 0.0, NULL, '[{"grams": 50, "label": "xícara"}]'::jsonb),
  (gen_random_uuid(), 'Cappuccino (xícara)', 'custom', 'br-dish-056', 'Alimentos preparados', 49, 2.2, 6.0, 1.8, NULL, '[{"grams": 200, "label": "xícara"}]'::jsonb),
  (gen_random_uuid(), 'Achocolatado com leite (copo)', 'custom', 'br-dish-057', 'Alimentos preparados', 94, 3.3, 13.5, 3.0, NULL, '[{"grams": 200, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Vitamina de banana com leite', 'custom', 'br-dish-058', 'Alimentos preparados', 74, 2.4, 11.5, 2.0, NULL, '[{"grams": 300, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Vitamina de morango com leite', 'custom', 'br-dish-059', 'Alimentos preparados', 62, 2.4, 8.7, 2.0, NULL, '[{"grams": 300, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Vitamina de mamão com leite', 'custom', 'br-dish-060', 'Alimentos preparados', 66, 2.3, 9.8, 2.0, NULL, '[{"grams": 300, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Vitamina de abacate com leite', 'custom', 'br-dish-061', 'Alimentos preparados', 110, 2.9, 9.0, 6.9, NULL, '[{"grams": 300, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Vitamina de manga com leite', 'custom', 'br-dish-062', 'Alimentos preparados', 72, 2.4, 11.2, 2.0, NULL, '[{"grams": 300, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Suco de laranja natural', 'custom', 'br-dish-063', 'Alimentos preparados', 45, 0.7, 10.4, 0.2, NULL, '[{"grams": 200, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Limonada (suco de limão adoçado)', 'custom', 'br-dish-064', 'Alimentos preparados', 35, 0.1, 9.0, 0.0, NULL, '[{"grams": 200, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Suco de maracujá adoçado', 'custom', 'br-dish-065', 'Alimentos preparados', 45, 0.3, 11.0, 0.1, NULL, '[{"grams": 200, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Suco de abacaxi com hortelã', 'custom', 'br-dish-066', 'Alimentos preparados', 45, 0.4, 11.0, 0.1, NULL, '[{"grams": 200, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Caldo de cana', 'custom', 'br-dish-067', 'Alimentos preparados', 72, 0.2, 18.0, 0.0, NULL, '[{"grams": 300, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Água de coco', 'custom', 'br-dish-068', 'Alimentos preparados', 19, 0.7, 3.7, 0.2, NULL, '[{"grams": 200, "label": "copo"}]'::jsonb),
  (gen_random_uuid(), 'Salada de frutas', 'custom', 'br-dish-069', 'Alimentos preparados', 50, 0.7, 12.5, 0.2, NULL, '[{"grams": 200, "label": "tigela"}]'::jsonb),
  (gen_random_uuid(), 'Iogurte natural com frutas e granola', 'custom', 'br-dish-070', 'Alimentos preparados', 101, 3.5, 15.0, 3.0, NULL, '[{"grams": 200, "label": "tigela"}]'::jsonb),
  (gen_random_uuid(), 'Pão na chapa (pão francês com manteiga)', 'custom', 'br-dish-071', 'Alimentos preparados', 320, 8.0, 54.0, 8.0, NULL, '[{"grams": 60, "label": "unidade"}]'::jsonb)
ON CONFLICT DO NOTHING;
COMMIT;
