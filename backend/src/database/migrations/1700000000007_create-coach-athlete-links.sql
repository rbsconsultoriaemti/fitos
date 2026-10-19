-- Up Migration
CREATE TABLE running_coach_athlete (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  running_coach_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (running_coach_id, athlete_id),
  CHECK (running_coach_id <> athlete_id)
);
CREATE INDEX running_coach_athlete_athlete_idx ON running_coach_athlete (athlete_id);

CREATE TABLE cycling_coach_athlete (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycling_coach_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycling_coach_id, athlete_id),
  CHECK (cycling_coach_id <> athlete_id)
);
CREATE INDEX cycling_coach_athlete_athlete_idx ON cycling_coach_athlete (athlete_id);

-- Down Migration
DROP TABLE cycling_coach_athlete;
DROP TABLE running_coach_athlete;
