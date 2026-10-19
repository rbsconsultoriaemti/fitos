-- Up Migration
CREATE TYPE user_role AS ENUM (
  'student', 'trainer', 'running_coach', 'cycling_coach',
  'nutritionist', 'psychologist', 'admin'
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'student',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_role_idx ON users (role);

-- Down Migration
DROP TABLE users;
DROP TYPE user_role;
