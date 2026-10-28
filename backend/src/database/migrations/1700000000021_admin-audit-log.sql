-- Up Migration
-- Trilha de auditoria das alterações feitas pelo administrador no portal (papel e ativação de contas).
-- Só recebe INSERT: um gatilho recusa UPDATE e DELETE. Sem chave estrangeira de propósito: o histórico sobrevive
-- mesmo se uma conta for apagada.
CREATE TABLE admin_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       UUID NOT NULL,
  target_user_id UUID NOT NULL,
  action         TEXT NOT NULL,
  before         JSONB NOT NULL,
  after          JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_target_idx ON admin_audit_log (target_user_id, created_at DESC);
CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log (actor_id, created_at DESC);

CREATE FUNCTION admin_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log é somente de inserção';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_no_change
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_immutable();

-- Down Migration
DROP TRIGGER admin_audit_log_no_change ON admin_audit_log;
DROP FUNCTION admin_audit_log_immutable();
DROP TABLE admin_audit_log;
