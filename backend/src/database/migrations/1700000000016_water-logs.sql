-- Up Migration
-- Consumo de água: um registro por gole/copo/garrafa. `client_id` torna idempotente o reenvio da fila offline do app.
CREATE TABLE water_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_ml  INTEGER NOT NULL CHECK (amount_ml BETWEEN 1 AND 2000),
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX water_logs_user_day_idx ON water_logs (user_id, logged_at);
CREATE UNIQUE INDEX water_logs_client_id_uq ON water_logs (user_id, client_id) WHERE client_id IS NOT NULL;

-- Down Migration
DROP TABLE water_logs;
