-- Up Migration
-- Plano prescrito pelo professor tem prioridade: ao ser aprovado, arquiva os planos ativos do aluno e registra aqui
-- qual plano os substituiu. Se o professor arquivar o plano dele, os planos próprios (self/ai) voltam a ficar ativos.
ALTER TABLE workout_plans ADD COLUMN superseded_by UUID REFERENCES workout_plans(id) ON DELETE SET NULL;
CREATE INDEX workout_plans_superseded_idx ON workout_plans (superseded_by) WHERE superseded_by IS NOT NULL;

-- Down Migration
DROP INDEX workout_plans_superseded_idx;
ALTER TABLE workout_plans DROP COLUMN superseded_by;
