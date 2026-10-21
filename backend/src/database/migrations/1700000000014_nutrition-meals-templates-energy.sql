-- Up Migration

-- 1) Refeições do dia: café, lanche da manhã, almoço, lanche da tarde, jantar.
ALTER TABLE food_logs DROP CONSTRAINT food_logs_meal_type_check;
-- O antigo 'snack' vira lanche da manhã (até 11h59) ou da tarde, pelo horário em São Paulo.
UPDATE food_logs SET meal_type = CASE
  WHEN extract(hour FROM logged_at AT TIME ZONE 'America/Sao_Paulo') < 12 THEN 'morning_snack'
  ELSE 'afternoon_snack'
END WHERE meal_type = 'snack';
ALTER TABLE food_logs ADD CONSTRAINT food_logs_meal_type_check
  CHECK (meal_type IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner'));

-- 2) Produtos industrializados do Open Food Facts (external_id = código de barras).
ALTER TABLE foods DROP CONSTRAINT foods_source_check;
ALTER TABLE foods ADD CONSTRAINT foods_source_check CHECK (source IN ('taco', 'custom', 'openfoodfacts'));

-- 3) Refeições favoritas: items = [{ "foodId": "...", "quantityG": 150 } | { "foodId": "...", "portion": { "label": "fatia", "count": 2 } }]
CREATE TABLE meal_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  meal_type  TEXT CHECK (meal_type IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner')),
  items      JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX meal_templates_user_name_unique ON meal_templates (user_id, lower(name));

-- 4) Meta de calorias definida manualmente pelo usuário (sobrescreve a calculada).
ALTER TABLE profiles ADD COLUMN kcal_target_override INT CHECK (kcal_target_override BETWEEN 800 AND 10000);

-- Down Migration
ALTER TABLE profiles DROP COLUMN kcal_target_override;
DROP TABLE meal_templates;
DELETE FROM foods WHERE source = 'openfoodfacts';
ALTER TABLE foods DROP CONSTRAINT foods_source_check;
ALTER TABLE foods ADD CONSTRAINT foods_source_check CHECK (source IN ('taco', 'custom'));
ALTER TABLE food_logs DROP CONSTRAINT food_logs_meal_type_check;
UPDATE food_logs SET meal_type = 'snack' WHERE meal_type IN ('morning_snack', 'afternoon_snack');
ALTER TABLE food_logs ADD CONSTRAINT food_logs_meal_type_check
  CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack'));
