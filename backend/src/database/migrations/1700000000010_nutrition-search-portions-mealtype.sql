-- Up Migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() é STABLE; este wrapper IMMUTABLE permite usá-lo em coluna gerada e índice.
CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Busca tolerante a acento, caixa e erro de digitação (trigram).
ALTER TABLE foods ADD COLUMN name_search TEXT GENERATED ALWAYS AS (f_unaccent(lower(name))) STORED;
CREATE INDEX foods_name_search_trgm_idx ON foods USING gin (name_search gin_trgm_ops);

-- Porções caseiras: [{"label": "fatia", "grams": 25}, ...]. Líquidos: 1 ml ≈ 1 g.
ALTER TABLE foods ADD COLUMN portions JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(portions) = 'array');

-- Refeição do dia escolhida pelo usuário, independente de plano alimentar.
ALTER TABLE food_logs ADD COLUMN meal_type     TEXT;
ALTER TABLE food_logs ADD COLUMN portion_label TEXT;
ALTER TABLE food_logs ADD COLUMN portion_count NUMERIC(5,2) CHECK (portion_count > 0);

-- Registros anteriores (sem tipo): inferidos pelo horário em São Paulo.
UPDATE food_logs SET meal_type = CASE
  WHEN extract(hour FROM logged_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 5 AND 10 THEN 'breakfast'
  WHEN extract(hour FROM logged_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 11 AND 15 THEN 'lunch'
  WHEN extract(hour FROM logged_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 18 AND 22 THEN 'dinner'
  ELSE 'snack'
END;
ALTER TABLE food_logs ALTER COLUMN meal_type SET NOT NULL;
ALTER TABLE food_logs ADD CONSTRAINT food_logs_meal_type_check
  CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack'));

-- Down Migration
ALTER TABLE food_logs DROP CONSTRAINT food_logs_meal_type_check;
ALTER TABLE food_logs DROP COLUMN portion_count;
ALTER TABLE food_logs DROP COLUMN portion_label;
ALTER TABLE food_logs DROP COLUMN meal_type;
ALTER TABLE foods DROP COLUMN portions;
DROP INDEX foods_name_search_trgm_idx;
ALTER TABLE foods DROP COLUMN name_search;
DROP FUNCTION f_unaccent(text);
