import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../../shared/http';
import { requireAuth, requireRole } from './auth.middleware';
import * as invites from './invites.service';

const acceptSchema = z.object({
  token: z.string().min(1),
  consentVersion: z.string().trim().min(1).max(40).optional(),
});

export const invitesRouter = Router();

invitesRouter.post(
  '/generate',
  requireAuth,
  requireRole('trainer', 'running_coach', 'cycling_coach', 'nutritionist', 'psychologist'),
  wrap(async (req, res) => {
    res.status(201).json(await invites.generateInvite(req.auth!.sub, req.auth!.role));
  }),
);

// O aluno chama logo após cadastro/login, com o access token recém-emitido.
invitesRouter.post(
  '/accept',
  requireAuth,
  wrap(async (req, res) => {
    const { token, consentVersion } = acceptSchema.parse(req.body);
    res.json(await invites.acceptInvite(token, { id: req.auth!.sub, role: req.auth!.role }, consentVersion));
  }),
);
