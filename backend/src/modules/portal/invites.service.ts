import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PoolClient } from 'pg';
import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { PAGE_SIZE } from './admin-users.schemas';
import { isProfessionalRole, normalizeRegistration, type Council } from '../../shared/professional-registration';
import type { PortalAccount } from './portal.access';

const BCRYPT_ROUNDS = 12;

/** O banco guarda só o hash SHA-256 (coluna `invites.token`); o token em claro existe apenas na resposta da criação. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type Db = Pick<PoolClient, 'query'>;
const audit = (db: Db, inviteId: string, actorId: string, action: string, details: Record<string, unknown>) =>
  db.query('INSERT INTO invite_audit_log (invite_id, actor_id, action, details) VALUES ($1, $2, $3, $4)', [inviteId, actorId, action, details]);

interface InviteRow {
  id: string;
  sender_id: string;
  role: string;
  email: string | null;
  status: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

/** Pendente mas vencido aparece como `expired` (nenhum job precisa rodar). */
const effectiveStatus = (i: InviteRow) => (i.status === 'pending' && i.expires_at.getTime() <= Date.now() ? 'expired' : i.status);

const present = (i: InviteRow & { sender_name?: string }) => ({
  id: i.id,
  role: i.role,
  email: i.email,
  status: effectiveStatus(i),
  createdAt: i.created_at,
  expiresAt: i.expires_at,
  usedAt: i.used_at,
  revokedAt: i.revoked_at,
  ...(i.sender_name !== undefined ? { createdBy: { id: i.sender_id, name: i.sender_name } } : {}),
});

/** Quem pode convidar para qual papel. `admin` nunca é atribuído por convite (nem pelo administrador). */
export function assertCanInvite(actor: PortalAccount, role: string) {
  if (role === 'admin') throw new AppError(400, 'invite_role_not_allowed', 'O papel de administrador não pode ser atribuído por convite');
  void actor; // administrador e profissional validado convidam qualquer papel de negócio; o guard da rota já filtrou o ator
}

export async function createInvite(actor: PortalAccount, input: { role: string; email?: string; expiresInDays?: number }) {
  assertCanInvite(actor, input.role);
  const token = randomBytes(32).toString('base64url'); // 256 bits
  const days = input.expiresInDays ?? config.invite.ttlDays;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO invites (sender_id, role, email, token, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [actor.id, input.role, input.email ?? null, hashToken(token), expiresAt],
    );
    await audit(client, rows[0].id, actor.id, 'invite_create', { role: input.role, email: input.email ?? null, expiresAt, actorRole: actor.role, actorIsPlatformAdmin: actor.isPlatformAdmin });
    await client.query('COMMIT');
    // Única vez em que o link existe em claro.
    return { id: rows[0].id, role: input.role, email: input.email ?? null, expiresAt, link: `${config.invite.portalBaseUrl}${token}` };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listInvites(actor: PortalAccount, page: number) {
  const where = actor.isPlatformAdmin ? '' : 'WHERE i.sender_id = $1';
  const params = actor.isPlatformAdmin ? [] : [actor.id];
  const total = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM invites i ${where}`, params)).rows[0].n);
  const { rows } = await pool.query<InviteRow & { sender_name: string }>(
    `SELECT i.id, i.sender_id, i.role, i.email, i.status, i.created_at, i.expires_at, i.used_at, i.revoked_at, u.name AS sender_name
       FROM invites i JOIN users u ON u.id = i.sender_id ${where}
      ORDER BY i.created_at DESC, i.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  return { items: rows.map(present), page, pageSize: PAGE_SIZE, total };
}

export async function revokeInvite(actor: PortalAccount, id: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<InviteRow>('SELECT * FROM invites WHERE id = $1 FOR UPDATE', [id]);
    const invite = rows[0];
    if (!invite) throw new AppError(404, 'invite_not_found', 'Convite não encontrado');
    if (invite.sender_id !== actor.id && !actor.isPlatformAdmin) throw new AppError(403, 'forbidden', 'Sem permissão');
    if (effectiveStatus(invite) !== 'pending') throw new AppError(409, 'invite_not_pending', 'Só convites pendentes podem ser revogados');
    const { rows: done } = await client.query<InviteRow>("UPDATE invites SET status = 'revoked', revoked_at = now() WHERE id = $1 RETURNING *", [id]);
    await audit(client, id, actor.id, 'invite_revoke', { role: invite.role, actorRole: actor.role, actorIsPlatformAdmin: actor.isPlatformAdmin, byOwner: invite.sender_id === actor.id });
    await client.query('COMMIT');
    return present(done[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Dados públicos do convite: papel, validade e o NOME de quem convidou. 404 se o token não existe; 410 se não está mais disponível. */
export async function describeInvite(token: string) {
  const { rows } = await pool.query<InviteRow & { sender_name: string; sender_active: boolean }>(
    `SELECT i.*, u.name AS sender_name, u.is_active AS sender_active FROM invites i JOIN users u ON u.id = i.sender_id WHERE i.token = $1`,
    [hashToken(token)],
  );
  const i = rows[0];
  if (!i) throw new AppError(404, 'invite_not_found', 'Convite não encontrado');
  if (effectiveStatus(i) !== 'pending' || !i.sender_active) throw new AppError(410, 'invite_unavailable', 'Convite expirado, já utilizado ou revogado');
  return { role: i.role, expiresAt: i.expires_at, invitedBy: i.sender_name, requiresEmail: i.email !== null, requiresRegistration: isProfessionalRole(i.role) };
}

export async function acceptInvite(
  token: string,
  input: { name: string; email: string; password: string; registrationCouncil?: Council; registrationNumber?: string },
) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<InviteRow & { sender_active: boolean }>(
      `SELECT i.*, (SELECT is_active FROM users s WHERE s.id = i.sender_id) AS sender_active FROM invites i WHERE i.token = $1 FOR UPDATE OF i`,
      [hashToken(token)],
    );
    const invite = rows[0];
    if (!invite) throw new AppError(404, 'invite_not_found', 'Convite não encontrado');
    if (effectiveStatus(invite) !== 'pending' || !invite.sender_active) throw new AppError(410, 'invite_unavailable', 'Convite expirado, já utilizado ou revogado');
    if (invite.email && invite.email.toLowerCase() !== input.email) throw new AppError(403, 'invite_email_mismatch', 'Este convite é para outro e-mail');

    // O papel vem SEMPRE da linha do convite; o corpo da requisição nunca o define.
    const role = invite.role;
    const professional = isProfessionalRole(role);
    let council: Council | null = null;
    let number: string | null = null;
    if (professional) {
      const reg = normalizeRegistration(role, input.registrationCouncil, input.registrationNumber);
      council = reg.council;
      number = reg.number;
    }

    const { rows: created } = await client.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, validation_status, registration_council, registration_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`,
      [input.name, input.email, passwordHash, role, professional ? 'pending' : 'approved', council, number],
    );
    if (!created[0]) throw new AppError(409, 'email_in_use', 'E-mail já cadastrado');
    const userId = created[0].id;

    await client.query("UPDATE invites SET status = 'accepted', used_at = now() WHERE id = $1", [invite.id]);
    await audit(client, invite.id, userId, 'invite_accept', { role, invitedBy: invite.sender_id, validationStatus: professional ? 'pending' : 'approved', registrationCouncil: council });
    await client.query('COMMIT');
    return { user: { id: userId, name: input.name, email: input.email, role, validationStatus: professional ? 'pending' : 'approved' } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---- Validação de profissionais (somente administrador) ----

export async function listPendingProfessionals(page: number) {
  const where = "WHERE validation_status = 'pending'";
  const total = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM users ${where}`)).rows[0].n);
  const { rows } = await pool.query(
    `SELECT id, name, email, role, registration_council, registration_number, created_at FROM users ${where}
      ORDER BY created_at, id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
  );
  return {
    items: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, registrationCouncil: u.registration_council, registrationNumber: u.registration_number, createdAt: u.created_at })),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
}

export async function decideProfessional(actor: PortalAccount, id: string, decision: 'approved' | 'rejected') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; role: string; validation_status: string }>('SELECT id, role, validation_status FROM users WHERE id = $1 FOR UPDATE', [id]);
    const u = rows[0];
    if (!u || !isProfessionalRole(u.role)) throw new AppError(404, 'professional_not_found', 'Profissional não encontrado');
    if (u.validation_status !== 'pending') {
      const was = u.validation_status === 'approved' ? 'já foi validado' : 'já foi rejeitado (a rejeição é final pela API)';
      throw new AppError(409, 'not_pending', `Este profissional ${was}; só contas pendentes de validação podem ser decididas.`);
    }
    await client.query('UPDATE users SET validation_status = $2, validated_by = $3, validated_at = now() WHERE id = $1', [id, decision, actor.id]);
    await client.query('INSERT INTO admin_audit_log (actor_id, target_user_id, action, before, after) VALUES ($1, $2, $3, $4, $5)', [
      actor.id,
      id,
      decision === 'approved' ? 'professional_validate' : 'professional_reject',
      { validationStatus: u.validation_status },
      { validationStatus: decision },
    ]);
    await client.query('COMMIT');
    return { id, validationStatus: decision };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
