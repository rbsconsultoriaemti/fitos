import { PoolClient } from 'pg';
import { pool } from '../../database/pool';

export type Role =
  | 'student'
  | 'trainer'
  | 'running_coach'
  | 'cycling_coach'
  | 'nutritionist'
  | 'psychologist'
  | 'admin';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  is_platform_admin: boolean;
  created_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/** Retorna null se o e-mail já existe (violação do índice único). */
export async function insertUser(
  name: string,
  email: string,
  passwordHash: string,
  role: Role,
  /** Só para profissionais: nascem 'pending' com o registro informado; o administrador valida depois. */
  registration?: { council: string; number: string | null; state: string },
): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (name, email, password_hash, role, validation_status, registration_council, registration_number, registration_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [name, email, passwordHash, role, registration ? 'pending' : 'approved', registration?.council ?? null, registration?.number ?? null, registration?.state ?? null],
  );
  return rows[0] ?? null;
}

export async function insertRefreshToken(
  userId: string,
  familyId: string,
  tokenHash: string,
  expiresAt: Date,
  db: Pick<PoolClient, 'query'> = pool,
): Promise<void> {
  await db.query(
    'INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, familyId, tokenHash, expiresAt],
  );
}

export async function findRefreshTokenForUpdate(
  tokenHash: string,
  db: Pick<PoolClient, 'query'>,
): Promise<RefreshTokenRow | null> {
  const { rows } = await db.query<RefreshTokenRow>(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function revokeRefreshToken(id: string, db: Pick<PoolClient, 'query'>): Promise<void> {
  await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
}

export async function revokeFamily(familyId: string, db: Pick<PoolClient, 'query'> = pool): Promise<void> {
  await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
    familyId,
  ]);
}

export async function revokeFamilyByTokenHash(tokenHash: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE revoked_at IS NULL
       AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [tokenHash],
  );
}
