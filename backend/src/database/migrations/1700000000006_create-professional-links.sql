-- Up Migration
CREATE TABLE trainer_student (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trainer_id, student_id),
  CHECK (trainer_id <> student_id)
);
CREATE INDEX trainer_student_student_idx ON trainer_student (student_id);

CREATE TABLE nutritionist_patient (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nutritionist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  consent_version TEXT NOT NULL,
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nutritionist_id, patient_id),
  CHECK (nutritionist_id <> patient_id)
);
CREATE INDEX nutritionist_patient_patient_idx ON nutritionist_patient (patient_id);

CREATE TABLE psychologist_patient (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  consent_version           TEXT NOT NULL,
  consent_signed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  share_mood_with_trainers  BOOLEAN NOT NULL DEFAULT FALSE,
  linked_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (psychologist_id, patient_id),
  CHECK (psychologist_id <> patient_id)
);
CREATE INDEX psychologist_patient_patient_idx ON psychologist_patient (patient_id);

-- Down Migration
DROP TABLE psychologist_patient;
DROP TABLE nutritionist_patient;
DROP TABLE trainer_student;
