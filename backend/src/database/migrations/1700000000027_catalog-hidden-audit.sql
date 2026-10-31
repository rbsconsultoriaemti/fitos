-- Up Migration
-- Catálogo (portal): alimento ocultado sai da busca dos alunos; registros antigos continuam válidos.
ALTER TABLE foods ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false;

-- Trilha das alterações do catálogo feitas no portal. Só recebe INSERT (gatilho recusa UPDATE e DELETE).
-- Sem chave estrangeira de propósito: o histórico sobrevive se o item for apagado.
CREATE TABLE catalog_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID NOT NULL,
  entity      TEXT NOT NULL CHECK (entity IN ('food')),
  entity_id   UUID NOT NULL,
  action      TEXT NOT NULL,
  before      JSONB NOT NULL,
  after       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX catalog_audit_log_entity_idx ON catalog_audit_log (entity, entity_id, created_at DESC);

CREATE FUNCTION catalog_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'catalog_audit_log é somente de inserção';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER catalog_audit_log_no_change
  BEFORE UPDATE OR DELETE ON catalog_audit_log
  FOR EACH ROW EXECUTE FUNCTION catalog_audit_log_immutable();

-- Down Migration
DROP TRIGGER catalog_audit_log_no_change ON catalog_audit_log;
DROP FUNCTION catalog_audit_log_immutable();
DROP TABLE catalog_audit_log;
ALTER TABLE foods DROP COLUMN IF EXISTS hidden;
