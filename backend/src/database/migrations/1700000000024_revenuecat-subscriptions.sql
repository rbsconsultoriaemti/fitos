-- Up Migration
-- Assinaturas vindas do RevenueCat (webhook POST /billing/revenuecat/webhook). A chave da assinatura continua em
-- `revenuecat_id` (original_transaction_id da loja). `last_event_at_ms` impede que um evento antigo sobrescreva um novo.
ALTER TABLE subscriptions
  ADD COLUMN store            TEXT,
  ADD COLUMN product_id       TEXT,
  ADD COLUMN environment      TEXT NOT NULL DEFAULT 'SANDBOX' CHECK (environment IN ('PRODUCTION', 'SANDBOX')),
  ADD COLUMN auto_renew       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN last_event_at_ms BIGINT,
  ADD COLUMN updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();

-- Cada evento recebido fica registrado: o mesmo evento nunca é processado duas vezes (o RevenueCat reenvia em caso de falha).
CREATE TABLE revenuecat_events (
  event_id    TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  app_user_id TEXT,
  product_id  TEXT,
  environment TEXT,
  outcome     TEXT NOT NULL,
  event_at    TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX revenuecat_events_user_idx ON revenuecat_events (app_user_id, received_at DESC);

-- Down Migration
DROP TABLE revenuecat_events;
ALTER TABLE subscriptions
  DROP COLUMN updated_at,
  DROP COLUMN last_event_at_ms,
  DROP COLUMN auto_renew,
  DROP COLUMN environment,
  DROP COLUMN product_id,
  DROP COLUMN store;
