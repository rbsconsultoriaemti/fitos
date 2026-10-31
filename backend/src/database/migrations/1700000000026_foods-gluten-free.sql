-- Up Migration
-- Alimento marcado como naturalmente sem glúten (filtro "Sem glúten" da busca).
ALTER TABLE foods ADD COLUMN gluten_free BOOLEAN NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE foods DROP COLUMN IF EXISTS gluten_free;
