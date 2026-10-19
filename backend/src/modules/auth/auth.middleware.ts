import { NextFunction, Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { Role } from './auth.repository';
import { AccessTokenPayload, verifyAccessToken } from './auth.service';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AccessTokenPayload;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'missing_token', 'Token não informado'));
  }
  try {
    req.auth = verifyAccessToken(header.slice(7));
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return next(new AppError(403, 'forbidden', 'Sem permissão'));
    }
    next();
  };
