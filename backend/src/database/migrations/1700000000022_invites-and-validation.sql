-- Up Migration
-- Convites do portal (conta nova com papel definido pelo servidor) e validação de profissionais pelo administrador.

-- 1) Validação do profissional. DEFAULT 'approved' para não afetar nenhuma conta existente; só quem aceita um convite
--    de papel profissional entra como 'pending'.
ALTER TABLE users
  ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'approved' CHECK (validation_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN registration_council TEXT CHECK (registration_council IN ('CRN', 'CREF', 'CRP', 'SEM_CONSELHO')),
  ADD COLUMN registration_number TEXT,
  ADD COLUMN validated_by UUID,
  ADD COLUMN validated_at TIMESTAMPTZ;
CREATE INDEX users_validation_pending_idx ON users (created_at) WHERE validation_status = 'pending';

-- 2) invites já existe (migration 004: id, sender_id = quem criou, role, token = HASH SHA-256, status, expires_at).
--    Só entra o que faltava. A coluna `token` já guarda apenas o hash e já é UNIQUE (índice único), então não se cria
--    uma segunda coluna token_hash.
ALTER TABLE invites
  ADD COLUMN email TEXT,
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN used_at TIMESTAMPTZ,
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD CONSTRAINT invites_role_not_admin CHECK (role <> 'admin');

-- 3) Auditoria dos convites: somente inserção, sem chave estrangeira (o histórico sobrevive às contas).
CREATE TABLE invite_audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id  UUID NOT NULL,
  actor_id   UUID NOT NULL,
  action     TEXT NOT NULL,
  details    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invite_audit_log_invite_idx ON invite_audit_log (invite_id, created_at DESC);
CREATE INDEX invite_audit_log_actor_idx ON invite_audit_log (actor_id, created_at DESC);

CREATE FUNCTION invite_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invite_audit_log é somente de inserção';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invite_audit_log_no_change
  BEFORE UPDATE OR DELETE ON invite_audit_log
  FOR EACH ROW EXECUTE FUNCTION invite_audit_log_immutable();

-- Down Migration
DROP TRIGGER invite_audit_log_no_change ON invite_audit_log;
DROP FUNCTION invite_audit_log_immutable();
DROP TABLE invite_audit_log;
ALTER TABLE invites
  DROP CONSTRAINT invites_role_not_admin,
  DROP COLUMN revoked_at,
  DROP COLUMN used_at,
  DROP COLUMN created_at,
  DROP COLUMN email;
DROP INDEX users_validation_pending_idx;
ALTER TABLE users
  DROP COLUMN validated_at,
  DROP COLUMN validated_by,
  DROP COLUMN registration_number,
  DROP COLUMN registration_council,
  DROP COLUMN validation_status;
