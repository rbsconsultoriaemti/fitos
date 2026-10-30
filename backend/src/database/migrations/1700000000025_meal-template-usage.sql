-- Up Migration
-- Frequência de uso das refeições favoritas: alimenta a sugestão "habitual" da refeição vazia.
ALTER TABLE meal_templates
  ADD COLUMN use_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_used_at TIMESTAMPTZ;

-- Down Migration
ALTER TABLE meal_templates
  DROP COLUMN IF EXISTS last_used_at,
  DROP COLUMN IF EXISTS use_count;
