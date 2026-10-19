-- Up Migration
CREATE TABLE exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'strength',
  muscle_group TEXT NOT NULL,
  equipment    TEXT,
  video_url    TEXT
);
CREATE UNIQUE INDEX exercises_name_unique ON exercises (lower(name));
CREATE INDEX exercises_muscle_group_idx ON exercises (muscle_group);

CREATE TABLE workout_plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prescribed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('ai', 'trainer', 'self')),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  duration_weeks INT CHECK (duration_weeks BETWEEN 1 AND 104),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workout_plans_owner_idx ON workout_plans (owner_id, status);
CREATE INDEX workout_plans_prescriber_idx ON workout_plans (prescribed_by);

CREATE TABLE workout_days (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1 = segunda ... 7 = domingo
  muscle_group TEXT NOT NULL,
  notes        TEXT,
  UNIQUE (plan_id, day_of_week)
);

CREATE TABLE workout_sets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id       UUID NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
  exercise_id  UUID NOT NULL REFERENCES exercises(id),
  sets         INT NOT NULL CHECK (sets BETWEEN 1 AND 20),
  reps         TEXT NOT NULL CHECK (reps ~ '^[0-9]+(-[0-9]+)?$'), -- "10" ou faixa "8-12"
  load_kg      NUMERIC(6,2) CHECK (load_kg >= 0),
  rest_seconds INT CHECK (rest_seconds BETWEEN 0 AND 1800),
  "order"      INT NOT NULL,
  UNIQUE (day_id, "order")
);

CREATE TABLE workout_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  day_id            UUID NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  perceived_effort  SMALLINT CHECK (perceived_effort BETWEEN 1 AND 10),
  notes             TEXT
);
CREATE INDEX workout_logs_student_idx ON workout_logs (student_id, performed_at DESC);
CREATE INDEX workout_logs_plan_idx ON workout_logs (plan_id);

CREATE TABLE set_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id         UUID NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  set_id         UUID NOT NULL REFERENCES workout_sets(id) ON DELETE CASCADE,
  sets_done      INT NOT NULL CHECK (sets_done BETWEEN 0 AND 50),
  load_done_kg   NUMERIC(6,2) CHECK (load_done_kg >= 0),
  reps_done      INT CHECK (reps_done BETWEEN 0 AND 1000),
  UNIQUE (log_id, set_id)
);

-- Down Migration
DROP TABLE set_logs;
DROP TABLE workout_logs;
DROP TABLE workout_sets;
DROP TABLE workout_days;
DROP TABLE workout_plans;
DROP TABLE exercises;
