import { createHash, randomBytes } from 'crypto';
import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { Role } from './auth.repository';

type LinkRole = 'trainer' | 'running_coach' | 'cycling_coach' | 'nutritionist' | 'psychologist';

const LINK_ROLES: Role[] = ['trainer', 'running_coach', 'cycling_coach', 'nutritionist', 'psychologist'];
const CONSENT_ROLES: Role[] = ['nutritionist', 'psychologist'];

// Tabelas de vínculo simples (sem consentimento): papel do profissional → tabela e colunas.
const SIMPLE_LINKS: Partial<Record<Role, { table: string; proCol: string; studentCol: string }>> = {
  trainer: { table: 'trainer_student', proCol: 'trainer_id', studentCol: 'student_id' },
  running_coach: { table: 'running_coach_athlete', proCol: 'running_coach_id', studentCol: 'athlete_id' },
  cycling_coach: { table: 'cycling_coach_athlete', proCol: 'cycling_coach_id', studentCol: 'athlete_id' },
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function canGenerateInvite(role: Role): role is LinkRole {
  return LINK_ROLES.includes(role);
}

export async function generateInvite(senderId: string, senderRole: Role) {
  if (!canGenerateInvite(senderRole)) {
    throw new AppError(403, 'invite_not_supported', 'Este papel ainda não pode gerar convites');
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.invite.ttlDays * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO invites (sender_id, role, token, expires_at) VALUES ($1, 'student', $2, $3)`,
    [senderId, hashToken(token), expiresAt],
  );
  // O token em texto puro só existe nesta resposta; o banco guarda o hash.
  return { token, link: `${config.invite.baseUrl}${token}`, expiresAt };
}

interface InviteRow {
  id: string;
  sender_id: string;
  role: Role;
  status: string;
  expires_at: Date;
}

export async function acceptInvite(
  token: string,
  student: { id: string; role: Role },
  consentVersion?: string,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<InviteRow>('SELECT * FROM invites WHERE token = $1 FOR UPDATE', [
      hashToken(token),
    ]);
    const invite = rows[0];
    if (!invite) throw new AppError(404, 'invite_not_found', 'Convite não encontrado');
    if (invite.status !== 'pending') throw new AppError(410, 'invite_unavailable', 'Convite já utilizado ou revogado');
    if (invite.expires_at.getTime() <= Date.now()) {
      await client.query(`UPDATE invites SET status = 'expired' WHERE id = $1`, [invite.id]);
      await client.query('COMMIT');
      throw new AppError(410, 'invite_expired', 'Convite expirado');
    }
    if (invite.role !== student.role) {
      throw new AppError(403, 'invite_role_mismatch', 'Este convite não é destinado ao seu tipo de conta');
    }
    if (invite.sender_id === student.id) {
      throw new AppError(400, 'invite_self', 'Você não pode aceitar o próprio convite');
    }

    const { rows: senders } = await client.query<{ role: Role; is_active: boolean; name: string }>(
      'SELECT role, is_active, name FROM users WHERE id = $1',
      [invite.sender_id],
    );
    const sender = senders[0];
    if (!sender || !sender.is_active || !canGenerateInvite(sender.role)) {
      throw new AppError(410, 'invite_unavailable', 'Convite não está mais disponível');
    }

    if (CONSENT_ROLES.includes(sender.role) && !consentVersion) {
      throw new AppError(400, 'consent_required', 'É necessário aceitar o termo de consentimento (consentVersion)');
    }

    let linked: unknown[];
    const simple = SIMPLE_LINKS[sender.role];
    if (simple) {
      // Nomes de tabela/coluna vêm da constante acima, nunca de input do usuário.
      ({ rows: linked } = await client.query(
        `INSERT INTO ${simple.table} (${simple.proCol}, ${simple.studentCol}) VALUES ($1, $2)
         ON CONFLICT (${simple.proCol}, ${simple.studentCol}) DO UPDATE SET status = 'active', linked_at = now()
           WHERE ${simple.table}.status <> 'active'
         RETURNING id`,
        [invite.sender_id, student.id],
      ));
    } else if (sender.role === 'nutritionist') {
      ({ rows: linked } = await client.query(
        `INSERT INTO nutritionist_patient (nutritionist_id, patient_id, consent_version) VALUES ($1, $2, $3)
         ON CONFLICT (nutritionist_id, patient_id) DO UPDATE
           SET status = 'active', consent_version = EXCLUDED.consent_version, linked_at = now()
           WHERE nutritionist_patient.status <> 'active'
         RETURNING id`,
        [invite.sender_id, student.id, consentVersion],
      ));
    } else {
      ({ rows: linked } = await client.query(
        `INSERT INTO psychologist_patient (psychologist_id, patient_id, consent_version) VALUES ($1, $2, $3)
         ON CONFLICT (psychologist_id, patient_id) DO UPDATE
           SET status = 'active', consent_version = EXCLUDED.consent_version,
               consent_signed_at = now(), linked_at = now()
           WHERE psychologist_patient.status <> 'active'
         RETURNING id`,
        [invite.sender_id, student.id, consentVersion],
      ));
    }

    // Sem linha retornada = vínculo ativo já existia; o convite não é consumido.
    if (linked.length === 0) throw new AppError(409, 'already_linked', 'Vínculo já existe');

    await client.query(`UPDATE invites SET status = 'accepted' WHERE id = $1`, [invite.id]);
    await client.query('COMMIT');

    return { linkType: sender.role, professional: { id: invite.sender_id, name: sender.name, role: sender.role } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
