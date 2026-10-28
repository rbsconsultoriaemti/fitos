import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { isProfessionalRole, normalizeRegistration } from '../../shared/professional-registration';
import {
  findRefreshTokenForUpdate,
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  insertUser,
  revokeFamily,
  revokeFamilyByTokenHash,
  revokeRefreshToken,
  Role,
  UserRow,
} from './auth.repository';
import { LoginInput, RegisterInput } from './auth.schemas';

const BCRYPT_ROUNDS = 12;
// Hash fixo para igualar o tempo de resposta quando o e-mail não existe.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', BCRYPT_ROUNDS);

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Só na resposta do cadastro: 'pending' para profissional (aguarda o administrador), 'approved' para aluno. */
  validationStatus?: 'pending' | 'approved';
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function toPublic(user: UserRow): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function signAccessToken(user: UserRow): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role };
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as AccessTokenPayload;
  } catch {
    throw new AppError(401, 'invalid_token', 'Token inválido ou expirado');
  }
}

async function issueRefreshToken(userId: string, familyId: string, db?: Parameters<typeof insertRefreshToken>[4]) {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);
  await insertRefreshToken(userId, familyId, hashToken(token), expiresAt, db);
  return token;
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  // Profissional se cadastra com o registro no conselho e entra pendente até o administrador validar.
  const registration = isProfessionalRole(input.role) ? normalizeRegistration(input.role, input.registrationCouncil, input.registrationNumber) : undefined;
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await insertUser(input.name, input.email, passwordHash, input.role, registration);
  if (!user) throw new AppError(409, 'email_in_use', 'E-mail já cadastrado');

  return {
    user: { ...toPublic(user), validationStatus: registration ? 'pending' : 'approved' },
    accessToken: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id, randomUUID()),
  };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await findUserByEmail(input.email);
  const ok = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok || !user.is_active) {
    throw new AppError(401, 'invalid_credentials', 'E-mail ou senha incorretos');
  }

  return {
    user: toPublic(user),
    accessToken: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id, randomUUID()),
  };
}

/**
 * Rotação: cada refresh token só vale uma vez. Reapresentar um token já usado
 * indica roubo, então a família inteira é revogada.
 */
export async function refresh(refreshToken: string): Promise<AuthResult> {
  const tokenHash = hashToken(refreshToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await findRefreshTokenForUpdate(tokenHash, client);

    if (!row) {
      await client.query('ROLLBACK');
      throw new AppError(401, 'invalid_refresh_token', 'Refresh token inválido');
    }

    if (row.revoked_at) {
      await revokeFamily(row.family_id, client);
      await client.query('COMMIT');
      throw new AppError(401, 'invalid_refresh_token', 'Refresh token inválido');
    }

    if (row.expires_at.getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      throw new AppError(401, 'invalid_refresh_token', 'Refresh token expirado');
    }

    const user = await findUserById(row.user_id);
    if (!user || !user.is_active) {
      await revokeFamily(row.family_id, client);
      await client.query('COMMIT');
      throw new AppError(401, 'invalid_refresh_token', 'Refresh token inválido');
    }

    await revokeRefreshToken(row.id, client);
    const newToken = await issueRefreshToken(user.id, row.family_id, client);
    await client.query('COMMIT');

    return { user: toPublic(user), accessToken: signAccessToken(user), refreshToken: newToken };
  } catch (err) {
    if (!(err instanceof AppError)) await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function logout(refreshToken: string): Promise<void> {
  await revokeFamilyByTokenHash(hashToken(refreshToken));
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await findUserById(userId);
  if (!user || !user.is_active) throw new AppError(401, 'invalid_token', 'Token inválido ou expirado');
  return toPublic(user);
}
