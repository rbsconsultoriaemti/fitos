import { Router } from 'express';
import { config } from '../../shared/config';
import { wrap } from '../../shared/http';
import { rateLimit } from '../../shared/rate-limit';
import { requireAuth } from '../auth/auth.middleware';
import { acceptInviteSchema, createInviteSchema, idParamSchema, pageQuerySchema, tokenParamSchema } from './invites.schemas';
import * as svc from './invites.service';
import { requirePlatformAdmin, requirePortalHeader, requireValidatedProfessional } from './portal.access';

/**
 * Convites do portal (/portal/invites/*). Criar, listar e revogar: administrador ou profissional JÁ VALIDADO (conta
 * pendente não convida ninguém). Consultar e aceitar pelo token são públicos, com limite por IP. O papel do novo usuário
 * vem sempre do convite no servidor.
 */
export const invitesRouter = Router();

const createLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.invite.createPerHour,
  key: (req) => `create:${req.auth?.sub ?? req.ip}`,
  code: 'invite_rate_limited',
  message: 'Muitos convites criados. Tente novamente mais tarde.',
});
// Por IP (consulta e aceitação compartilham o mesmo balde, contra varredura de tokens).
const publicLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.invite.acceptPer15Min,
  key: (req) => `public:${req.ip}`,
  code: 'invite_rate_limited',
  message: 'Muitas tentativas. Tente novamente em alguns minutos.',
});

invitesRouter.post(
  '/',
  requireAuth,
  requireValidatedProfessional,
  requirePortalHeader,
  createLimit,
  wrap(async (req, res) => {
    res.status(201).json(await svc.createInvite(req.account!, createInviteSchema.parse(req.body)));
  }),
);

invitesRouter.get(
  '/',
  requireAuth,
  requireValidatedProfessional,
  wrap(async (req, res) => {
    res.json(await svc.listInvites(req.account!, pageQuerySchema.parse(req.query).page));
  }),
);

// Rotas com /token/ vêm antes de /:id para nunca serem confundidas.
invitesRouter.get(
  '/token/:token',
  publicLimit,
  wrap(async (req, res) => {
    res.json(await svc.describeInvite(tokenParamSchema.parse(req.params).token));
  }),
);

invitesRouter.post(
  '/token/:token/accept',
  publicLimit,
  wrap(async (req, res) => {
    const { token } = tokenParamSchema.parse(req.params);
    res.status(201).json(await svc.acceptInvite(token, acceptInviteSchema.parse(req.body)));
  }),
);

invitesRouter.post(
  '/:id/revoke',
  requireAuth,
  requireValidatedProfessional,
  requirePortalHeader,
  wrap(async (req, res) => {
    res.json(await svc.revokeInvite(req.account!, idParamSchema.parse(req.params).id));
  }),
);

/** Validação de profissionais: SOMENTE o administrador da plataforma (/portal/admin/professionals/*). */
export const professionalsAdminRouter = Router();
professionalsAdminRouter.use(requireAuth, requirePlatformAdmin);

professionalsAdminRouter.get(
  '/pending',
  wrap(async (req, res) => {
    res.json(await svc.listPendingProfessionals(pageQuerySchema.parse(req.query).page));
  }),
);
professionalsAdminRouter.post(
  '/:id/validate',
  requirePortalHeader,
  wrap(async (req, res) => {
    res.json(await svc.decideProfessional(req.account!, idParamSchema.parse(req.params).id, 'approved'));
  }),
);
professionalsAdminRouter.post(
  '/:id/reject',
  requirePortalHeader,
  wrap(async (req, res) => {
    res.json(await svc.decideProfessional(req.account!, idParamSchema.parse(req.params).id, 'rejected'));
  }),
);
