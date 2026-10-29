-- Lote 4: 20 acompanhamentos de boteco carioca (br-dish-157 a br-dish-176) com porções
-- Valores por 100 g estimados; revisar. Idempotente (ON CONFLICT DO NOTHING).
BEGIN;
INSERT INTO foods (id, name, source, external_id, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, barcode, portions)
VALUES
  (gen_random_uuid(), 'Arroz biro-biro', 'custom', 'br-dish-157', 'Alimentos preparados', 190, 5.0, 21.0, 9.5, NULL, '[{"grams": 200, "label": "prato"}]'::jsonb),
  (gen_random_uuid(), 'Arroz de brócolis', 'custom', 'br-dish-158', 'Alimentos preparados', 136, 3.0, 23.0, 3.5, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Arroz à piamontese', 'custom', 'br-dish-159', 'Alimentos preparados', 185, 5.0, 22.0, 8.5, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Arroz com lentilha', 'custom', 'br-dish-160', 'Alimentos preparados', 132, 5.5, 22.0, 2.5, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Farofa de ovos', 'custom', 'br-dish-161', 'Alimentos preparados', 330, 6.0, 45.0, 14.0, NULL, '[{"grams": 50, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Farofa de banana', 'custom', 'br-dish-162', 'Alimentos preparados', 277, 1.5, 52.0, 7.0, NULL, '[{"grams": 50, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Batata sauté', 'custom', 'br-dish-163', 'Alimentos preparados', 130, 2.0, 17.0, 6.0, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Batata rústica assada com alecrim', 'custom', 'br-dish-164', 'Alimentos preparados', 120, 2.2, 18.0, 4.3, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Batata a murro', 'custom', 'br-dish-165', 'Alimentos preparados', 153, 2.5, 19.0, 7.5, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Aipim cozido com manteiga', 'custom', 'br-dish-166', 'Alimentos preparados', 165, 1.2, 30.0, 4.5, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Purê de aipim', 'custom', 'br-dish-167', 'Alimentos preparados', 123, 1.0, 22.0, 3.5, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Aipim com carne seca', 'custom', 'br-dish-168', 'Alimentos preparados', 200, 13.0, 19.0, 8.0, NULL, '[{"grams": 200, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Brócolis refogado no alho', 'custom', 'br-dish-169', 'Alimentos preparados', 59, 3.0, 5.0, 3.0, NULL, '[{"grams": 100, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Quiabo refogado com tomate', 'custom', 'br-dish-170', 'Alimentos preparados', 60, 1.8, 6.0, 3.2, NULL, '[{"grams": 100, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Salada de maionese com legumes', 'custom', 'br-dish-171', 'Alimentos preparados', 143, 2.0, 10.0, 10.5, NULL, '[{"grams": 100, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Cebola empanada', 'custom', 'br-dish-172', 'Alimentos preparados', 289, 4.0, 30.0, 17.0, NULL, '[{"grams": 100, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Banana à milanesa', 'custom', 'br-dish-173', 'Alimentos preparados', 230, 3.0, 33.0, 9.5, NULL, '[{"grams": 80, "label": "unidade"}]'::jsonb),
  (gen_random_uuid(), 'Polenta cremosa', 'custom', 'br-dish-174', 'Alimentos preparados', 95, 2.4, 12.0, 4.2, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Feijão preto com linguiça', 'custom', 'br-dish-175', 'Alimentos preparados', 126, 7.0, 11.0, 6.0, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb),
  (gen_random_uuid(), 'Feijão com paio e bacon', 'custom', 'br-dish-176', 'Alimentos preparados', 133, 7.5, 10.0, 7.0, NULL, '[{"grams": 150, "label": "porção"}]'::jsonb)
ON CONFLICT DO NOTHING;
COMMIT;
