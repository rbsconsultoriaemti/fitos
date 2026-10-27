import { Router } from 'express';
import { wrap } from '../../shared/http';
import { requireAuth } from '../auth/auth.middleware';
import { updateProfileSchema } from '../profile/profile.schemas';
import { requireQuota } from '../quotas/quotas.middleware';
import * as service from './onboarding.service';

export const onboardingRouter = Router();
onboardingRouter.use(requireAuth);

// Gera plano de treino + plano alimentar + metas. O corpo é opcional: se vier (mesmo formato do PUT /profile,
// com `onboarding.answers`), é gravado antes; sem corpo, vale o que as etapas já salvaram.
onboardingRouter.post(
  '/complete',
  requireQuota('ai_workout_plan'),
  wrap(async (req, res) => {
    const body = req.body && Object.keys(req.body).length > 0 ? updateProfileSchema.parse(req.body) : undefined;
    res.status(201).json(await service.completeOnboarding(req.auth!.sub, body));
  }),
);
