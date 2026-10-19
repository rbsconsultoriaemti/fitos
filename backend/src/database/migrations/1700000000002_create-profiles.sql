-- Up Migration
CREATE TABLE profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  weight_kg     NUMERIC(5,2) CHECK (weight_kg > 0),
  height_cm     NUMERIC(5,1) CHECK (height_cm > 0),
  birth_date    DATE,
  goal          TEXT,
  fitness_level TEXT CHECK (fitness_level IN ('beginner', 'intermediate', 'advanced')),
  restrictions  TEXT[] NOT NULL DEFAULT '{}'
);

-- Down Migration
DROP TABLE profiles;
