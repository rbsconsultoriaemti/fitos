import { Router } from 'express';
import { wrap } from '../../shared/http';
import { requireAuth } from '../auth/auth.middleware';
import { requirePlatformAdmin, requirePortalHeader } from './portal.access';
import { auditQuerySchema, idParamSchema, listQuerySchema, patchBodySchema } from './admin-users.schemas';
import * as svc from './admin-users.service';

/**
 * Usuários e papéis (/portal/admin/*). Tudo exige administrador da plataforma, conferido no banco a cada requisição.
 * Nenhuma rota grava `is_platform_admin` (só o script grant-platform-admin) nem atribui o papel `admin`.
 */
export const adminUsersRouter = Router();
adminUsersRouter.use(requireAuth, requirePlatformAdmin);

adminUsersRouter.get(
  '/users',
  wrap(async (req, res) => {
    const { q, page } = listQuerySchema.parse(req.query);
    res.json(await svc.listUsers(q || undefined, page));
  }),
);

adminUsersRouter.get(
  '/users/:id',
  wrap(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await svc.getUser(req.account!.id, id));
  }),
);

adminUsersRouter.patch(
  '/users/:id',
  requirePortalHeader,
  wrap(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = patchBodySchema.parse(req.body);
    res.json(await svc.updateUser(req.account!.id, id, body));
  }),
);

adminUsersRouter.get(
  '/audit',
  wrap(async (req, res) => {
    const { userId, page } = auditQuerySchema.parse(req.query);
    res.json(await svc.listAudit(userId, page));
  }),
);
