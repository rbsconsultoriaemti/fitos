import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../../shared/http';
import { requireAuth } from '../auth/auth.middleware';
import { requirePlatformAdmin } from './portal.access';
import { listQuerySchema } from './admin-users.schemas';
import * as reports from './admin-reports.service';

/** Métricas e assinaturas do portal (/portal/admin/metrics, /portal/admin/subscriptions). Só administrador da plataforma. */
export const adminReportsRouter = Router();
adminReportsRouter.use(requireAuth, requirePlatformAdmin);

const metricsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

adminReportsRouter.get(
  '/metrics',
  wrap(async (req, res) => {
    const { days } = metricsQuery.parse(req.query);
    res.json(await reports.getMetrics(days));
  }),
);

adminReportsRouter.get(
  '/subscriptions',
  wrap(async (req, res) => {
    const { q, page } = listQuerySchema.parse(req.query);
    res.json(await reports.listSubscriptions(q || undefined, page));
  }),
);
