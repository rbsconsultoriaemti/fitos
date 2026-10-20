-- Up Migration
-- Cardio (corrida/bike) dentro do plano: prescrição por tempo e distância em vez de séries x reps.
ALTER TABLE workout_sets ALTER COLUMN reps DROP NOT NULL;
ALTER TABLE workout_sets ADD COLUMN duration_min INT CHECK (duration_min BETWEEN 1 AND 1440);
ALTER TABLE workout_sets ADD COLUMN distance_km NUMERIC(6,2) CHECK (distance_km > 0);
ALTER TABLE workout_sets ADD CONSTRAINT workout_sets_prescription_check
  CHECK (reps IS NOT NULL OR duration_min IS NOT NULL OR distance_km IS NOT NULL);

ALTER TABLE set_logs ADD COLUMN duration_done_min INT CHECK (duration_done_min BETWEEN 0 AND 1440);
ALTER TABLE set_logs ADD COLUMN distance_done_km NUMERIC(6,2) CHECK (distance_done_km >= 0);

-- Trocar/remover um exercício que já tem execuções arquiva a linha (preserva o histórico) em vez de apagar.
ALTER TABLE workout_sets ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE workout_sets DROP COLUMN archived;
ALTER TABLE set_logs DROP COLUMN distance_done_km;
ALTER TABLE set_logs DROP COLUMN duration_done_min;
ALTER TABLE workout_sets DROP CONSTRAINT workout_sets_prescription_check;
ALTER TABLE workout_sets DROP COLUMN distance_km;
ALTER TABLE workout_sets DROP COLUMN duration_min;
ALTER TABLE workout_sets ALTER COLUMN reps SET NOT NULL;
