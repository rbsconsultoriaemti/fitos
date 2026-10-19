import { Router } from 'express';
import { wrap } from '../../shared/http';
import { requireAuth } from './auth.middleware';
import { loginSchema, refreshSchema, registerSchema } from './auth.schemas';
import * as service from './auth.service';

export const authRouter = Router();

authRouter.post(
  '/register',
  wrap(async (req, res) => {
    res.status(201).json(await service.register(registerSchema.parse(req.body)));
  }),
);

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    res.json(await service.login(loginSchema.parse(req.body)));
  }),
);

authRouter.post(
  '/refresh',
  wrap(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    res.json(await service.refresh(refreshToken));
  }),
);

authRouter.post(
  '/logout',
  wrap(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    await service.logout(refreshToken);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    res.json(await service.getMe(req.auth!.sub));
  }),
);
