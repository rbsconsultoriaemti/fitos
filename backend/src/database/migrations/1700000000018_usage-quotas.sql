-- Up Migration
-- Uso de recursos de IA por usuário, para as cotas por plano (janela deslizante: conta os usos com used_at dentro da janela).
CREATE TABLE usage_quotas (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('photo_recognition', 'ai_workout_plan')),
  used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ref_id   TEXT
);
CREATE INDEX usage_quotas_user_kind_used_idx ON usage_quotas (user_id, kind, used_at);

-- Down Migration
DROP TABLE usage_quotas;
