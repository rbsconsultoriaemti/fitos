import { NextFunction, Request, Response } from 'express';
import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { Role } from '../auth/auth.repository';

/** Papéis de negócio dos profissionais. O papel `admin` antigo NÃO conta: administrador da plataforma é o marcador. */
export const PROFESSIONAL_ROLES: Role[] = ['trainer', 'running_coach', 'cycling_coach', 'nutritionist', 'psychologist'];

export interface PortalAccount {
  id: string;
  role: Role;
  isPlatformAdmin: boolean;
  /** 'pending' | 'approved' | 'rejected'. Só profissionais convidados nascem pendentes; o administrador decide. */
  validationStatus: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Conta conferida no banco nesta requisição (preenchida pelos middlewares do portal). */
    account?: PortalAccount;
  }
}

/**
 * Lê a conta no BANCO a cada requisição: o JWT dura 15 min e leva o papel de quando foi emitido, então desativar,
 * rebaixar ou revogar o marcador precisa valer na próxima chamada, sem esperar o token expirar.
 */
async function loadAccount(req: Request): Promise<PortalAccount> {
  if (!req.auth) throw new AppError(401, 'missing_token', 'Token não informado');
  const { rows } = await pool.query<{ id: string; role: Role; is_active: boolean; is_platform_admin: boolean; validation_status: string }>(
    'SELECT id, role, is_active, is_platform_admin, validation_status FROM users WHERE id = $1',
    [req.auth.sub],
  );
  const u = rows[0];
  if (!u || !u.is_active) throw new AppError(401, 'invalid_token', 'Token inválido ou expirado');
  req.account = { id: u.id, role: u.role, isPlatformAdmin: u.is_platform_admin, validationStatus: u.validation_status };
  req.auth = { sub: u.id, role: u.role }; // papel atual, não o do JWT
  return req.account;
}

const guard = (allowed: (a: PortalAccount) => boolean) => async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const account = await loadAccount(req);
    if (!allowed(account)) throw new AppError(403, 'forbidden', 'Sem permissão');
    next();
  } catch (err) {
    next(err);
  }
};

/** Qualquer conta ativa entra no portal; o que ela pode fazer é decidido rota por rota. Use depois de `requireAuth`. */
export const requirePortalAccess = guard(() => true);

/** Só administrador da plataforma (`users.is_platform_admin = true`). Use depois de `requireAuth`. */
export const requirePlatformAdmin = guard((a) => a.isPlatformAdmin);

/** Profissional (papel de profissional) ou administrador da plataforma. Use depois de `requireAuth`. */
export const requireProfessional = guard((a) => a.isPlatformAdmin || PROFESSIONAL_ROLES.includes(a.role));

const NOT_VALIDATED = () => new AppError(403, 'professional_not_validated', 'Seu registro profissional ainda não foi validado pelo administrador');

/**
 * Profissional JÁ VALIDADO pelo administrador (ou o próprio administrador da plataforma). Não profissional => 403
 * `forbidden`; profissional pendente ou rejeitado => 403 `professional_not_validated`. O estado é lido do banco a cada
 * requisição. Use depois de `requireAuth` (e de `requireRole`, nas rotas antigas).
 */
export const requireValidatedProfessional = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const a = await loadAccount(req);
    if (a.isPlatformAdmin) return next();
    if (!PROFESSIONAL_ROLES.includes(a.role)) throw new AppError(403, 'forbidden', 'Sem permissão');
    if (a.validationStatus !== 'approved') throw NOT_VALIDATED();
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Para rotas antigas cujo `requireRole` também aceita o papel legado `admin` (cadastro de exercícios e de alimentos):
 * igual ao anterior, mas o papel `admin` continua passando, como já passava. (No portal o papel `admin` NÃO vale.)
 */
export const requireValidatedProfessionalOrLegacyAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const a = await loadAccount(req);
    if (a.role === 'admin') return next();
  } catch (err) {
    return next(err);
  }
  return requireValidatedProfessional(req, res, next);
};

/**
 * Rotas compartilhadas entre aluno e profissional (criar/editar/arquivar plano): aluno passa; administrador passa;
 * profissional só se `approved`. Pendente ou rejeitado => 403 `professional_not_validated`.
 */
export const requireValidatedIfProfessional = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const a = await loadAccount(req);
    if (a.isPlatformAdmin || !PROFESSIONAL_ROLES.includes(a.role)) return next();
    if (a.validationStatus !== 'approved') throw NOT_VALIDATED();
    next();
  } catch (err) {
    next(err);
  }
};

/** Defesa extra contra CSRF além do SameSite=Strict: um formulário de outro site não consegue mandar este cabeçalho. */
export function requirePortalHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.headers['x-fitos-portal'] !== '1') return next(new AppError(400, 'portal_header_missing', 'Requisição inválida'));
  next();
}
