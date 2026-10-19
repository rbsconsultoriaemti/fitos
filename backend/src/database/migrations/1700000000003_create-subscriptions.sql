-- Up Migration
CREATE TABLE subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL CHECK (plan IN ('free', 'premium')),
  status        TEXT NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'expired')),
  expires_at    TIMESTAMPTZ,
  revenuecat_id TEXT
);

CREATE INDEX subscriptions_user_idx ON subscriptions (user_id);
CREATE UNIQUE INDEX subscriptions_revenuecat_unique ON subscriptions (revenuecat_id) WHERE revenuecat_id IS NOT NULL;

-- Down Migration
DROP TABLE subscriptions;
