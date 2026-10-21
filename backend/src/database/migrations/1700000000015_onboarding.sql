-- Up Migration
-- Progresso do questionário de onboarding: respostas que não têm coluna própria ficam em `onboarding` (jsonb).
ALTER TABLE profiles ADD COLUMN onboarding JSONB;
ALTER TABLE profiles ADD COLUMN onboarding_step SMALLINT CHECK (onboarding_step BETWEEN 1 AND 7);
ALTER TABLE profiles ADD COLUMN onboarding_completed_at TIMESTAMPTZ;

-- Down Migration
ALTER TABLE profiles DROP COLUMN onboarding_completed_at;
ALTER TABLE profiles DROP COLUMN onboarding_step;
ALTER TABLE profiles DROP COLUMN onboarding;
