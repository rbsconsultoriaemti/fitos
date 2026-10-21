import { Router } from 'express';
import { wrap } from '../../shared/http';
import { requireAuth } from '../auth/auth.middleware';
import * as service from './onboarding.service';

export const onboardingRouter = Router();
onboardingRouter.use(requireAuth);

// Gera plano de treino + metas de nutrição a partir das respostas já salvas via PUT /profile.
onboardingRouter.post(
  '/complete',
  wrap(async (req, res) => {
    res.status(201).json(await service.completeOnboarding(req.auth!.sub));
  }),
);
