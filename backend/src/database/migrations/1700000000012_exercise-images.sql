-- Up Migration
-- Imagens de demonstração do exercício (2 quadros do movimento), do dataset de domínio público free-exercise-db.
ALTER TABLE exercises ADD COLUMN image_urls TEXT[] NOT NULL DEFAULT '{}';

-- Down Migration
ALTER TABLE exercises DROP COLUMN image_urls;
