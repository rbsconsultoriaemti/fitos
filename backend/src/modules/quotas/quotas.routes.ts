import { Router } from 'express';
import { wrap } from '../../shared/http';
import { requireAuth } from '../auth/auth.middleware';
import { getQuotaStatus } from './quotas.service';

export const quotasRouter = Router();
quotasRouter.use(requireAuth);

// Contador do app: quanto resta e quando libera, por recurso.
quotasRouter.get(
  '/',
  wrap(async (req, res) => {
    const [photoRecognition, aiWorkoutPlan] = await Promise.all([
      getQuotaStatus(req.auth!.sub, 'photo_recognition'),
      getQuotaStatus(req.auth!.sub, 'ai_workout_plan'),
    ]);
    res.json({ photo_recognition: photoRecognition, ai_workout_plan: aiWorkoutPlan });
  }),
);
