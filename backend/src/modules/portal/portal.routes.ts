import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from '../../shared/errors';
import { wrap } from '../../shared/http';
import { config } from '../../shared/config';
import { requireAuth } from '../auth/auth.middleware';
import { loginSchema } from '../auth/auth.schemas';
import * as auth from '../auth/auth.service';
import { requirePortalAccess } from './portal.access';

const COOKIE = 'fitos_portal_rt';
const COOKIE_PATH = '/portal'; // o navegador só envia o cookie para estas rotas, nunca para o resto da API

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setRefreshCookie(res: Response, token: string) {
  const maxAge = config.jwt.refreshTtlDays * 24 * 60 * 60;
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${config.env === 'production' ? '; Secure' : ''}`);
}
function clearRefreshCookie(res: Response) {
  res.append('Set-Cookie', `${COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict${config.env === 'production' ? '; Secure' : ''}`);
}

/** Defesa extra contra CSRF além do SameSite=Strict: um formulário de outro site não consegue mandar este cabeçalho. */
function requirePortalHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.headers['x-fitos-portal'] !== '1') return next(new AppError(400, 'portal_header_missing', 'Requisição inválida'));
  next();
}

export const portalRouter = Router();

portalRouter.post(
  '/login',
  requirePortalHeader,
  wrap(async (req, res) => {
    const result = await auth.login(loginSchema.parse(req.body));
    setRefreshCookie(res, result.refreshToken);
    res.json({ user: result.user, accessToken: result.accessToken });
  }),
);

portalRouter.post(
  '/refresh',
  requirePortalHeader,
  wrap(async (req, res) => {
    const token = readCookie(req, COOKIE);
    if (!token) throw new AppError(401, 'invalid_refresh_token', 'Sessão expirada');
    let result;
    try {
      result = await auth.refresh(token);
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
    setRefreshCookie(res, result.refreshToken);
    res.json({ user: result.user, accessToken: result.accessToken });
  }),
);

portalRouter.post(
  '/logout',
  requirePortalHeader,
  wrap(async (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) await auth.logout(token);
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

/**
 * Quem está logado, conferido no banco. `role` é o papel de negócio; `isPlatformAdmin` é o marcador de administrador
 * da plataforma (só leitura: nenhuma rota grava esse campo).
 */
portalRouter.get(
  '/me',
  requireAuth,
  requirePortalAccess,
  wrap(async (req, res) => {
    const user = await auth.getMe(req.auth!.sub);
    res.json({ ...user, isPlatformAdmin: req.account!.isPlatformAdmin });
  }),
);
