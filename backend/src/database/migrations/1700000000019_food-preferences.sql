-- Up Migration
-- Preferências alimentares do questionário: só "gosto" e "não gosto" são guardados; "indiferente" = sem linha.
-- `item_key` é a chave estável do catálogo (backend/src/modules/preferences/food-catalog.ts).
CREATE TABLE food_preferences (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL,
  stance     TEXT NOT NULL CHECK (stance IN ('like', 'dislike')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_key)
);

-- O onboarding ganhou uma etapa (preferências alimentares): agora são 8.
ALTER TABLE profiles DROP CONSTRAINT profiles_onboarding_step_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_onboarding_step_check CHECK (onboarding_step BETWEEN 1 AND 8);

-- Down Migration
UPDATE profiles SET onboarding_step = 7 WHERE onboarding_step > 7;
ALTER TABLE profiles DROP CONSTRAINT profiles_onboarding_step_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_onboarding_step_check CHECK (onboarding_step BETWEEN 1 AND 7);
DROP TABLE food_preferences;
