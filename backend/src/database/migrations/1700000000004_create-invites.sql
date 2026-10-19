-- Up Migration
CREATE TABLE invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       user_role NOT NULL DEFAULT 'student',
  token      TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX invites_sender_idx ON invites (sender_id);

-- Down Migration
DROP TABLE invites;
