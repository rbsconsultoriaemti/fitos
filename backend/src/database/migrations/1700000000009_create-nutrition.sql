-- Up Migration
CREATE TABLE foods (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  source             TEXT NOT NULL CHECK (source IN ('taco', 'custom')),
  external_id        TEXT,             -- id na fonte (ex.: número do alimento na TACO), para importação idempotente
  category           TEXT,
  kcal_per_100g      NUMERIC(7,2) NOT NULL CHECK (kcal_per_100g >= 0),
  protein_per_100g   NUMERIC(6,2) NOT NULL CHECK (protein_per_100g >= 0),
  carb_per_100g      NUMERIC(6,2) NOT NULL CHECK (carb_per_100g >= 0),
  fat_per_100g       NUMERIC(6,2) NOT NULL CHECK (fat_per_100g >= 0),
  barcode            TEXT
);
CREATE UNIQUE INDEX foods_source_external_unique ON foods (source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX foods_custom_name_unique ON foods (lower(name)) WHERE source = 'custom';
CREATE INDEX foods_name_idx ON foods (lower(name));
CREATE INDEX foods_barcode_idx ON foods (barcode) WHERE barcode IS NOT NULL;

CREATE TABLE diet_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prescribed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('ai', 'nutritionist', 'self')),
  target_kcal      NUMERIC(7,1) CHECK (target_kcal > 0),
  target_protein_g NUMERIC(6,1) CHECK (target_protein_g >= 0),
  target_carb_g    NUMERIC(6,1) CHECK (target_carb_g >= 0),
  target_fat_g     NUMERIC(6,1) CHECK (target_fat_g >= 0),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX diet_plans_patient_idx ON diet_plans (patient_id, status);
CREATE INDEX diet_plans_prescriber_idx ON diet_plans (prescribed_by);

CREATE TABLE meals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID NOT NULL REFERENCES diet_plans(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  "order"         INT NOT NULL,
  time_suggestion TIME,
  UNIQUE (plan_id, "order")
);

CREATE TABLE meal_foods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id     UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  food_id     UUID NOT NULL REFERENCES foods(id),
  quantity_g  NUMERIC(7,1) NOT NULL CHECK (quantity_g > 0)
);
CREATE INDEX meal_foods_meal_idx ON meal_foods (meal_id);

CREATE TABLE food_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id            UUID NOT NULL REFERENCES foods(id),
  meal_id            UUID REFERENCES meals(id) ON DELETE SET NULL,
  quantity_g         NUMERIC(7,1) NOT NULL CHECK (quantity_g > 0),
  photo_url          TEXT,
  recognition_source TEXT NOT NULL DEFAULT 'manual' CHECK (recognition_source IN ('manual', 'photo_ai')),
  logged_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX food_logs_user_time_idx ON food_logs (user_id, logged_at DESC);

-- Derivada: gerada por job noturno, nunca escrita pela API em tempo real.
CREATE TABLE daily_summaries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date            DATE NOT NULL,
  total_kcal          NUMERIC(8,1) NOT NULL DEFAULT 0,
  total_protein_g     NUMERIC(7,1) NOT NULL DEFAULT 0,
  total_carb_g        NUMERIC(7,1) NOT NULL DEFAULT 0,
  total_fat_g         NUMERIC(7,1) NOT NULL DEFAULT 0,
  workout_kcal_burned NUMERIC(8,1),
  UNIQUE (user_id, log_date)
);

-- Down Migration
DROP TABLE daily_summaries;
DROP TABLE food_logs;
DROP TABLE meal_foods;
DROP TABLE meals;
DROP TABLE diet_plans;
DROP TABLE foods;
