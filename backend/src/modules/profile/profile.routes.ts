import { Router } from 'express';
import { wrap } from '../../shared/http';
import { requireAuth } from '../auth/auth.middleware';
import { updateProfileSchema } from './profile.schemas';
import * as service from './profile.service';

export const profileRouter = Router();
profileRouter.use(requireAuth);

// Dados pessoais e biométricos do próprio usuário (dados de saúde: só o dono acessa).
profileRouter.get(
  '/',
  wrap(async (req, res) => {
    res.json(await service.getProfile(req.auth!.sub));
  }),
);

profileRouter.put(
  '/',
  wrap(async (req, res) => {
    res.json(await service.updateProfile(req.auth!.sub, updateProfileSchema.parse(req.body)));
  }),
);
