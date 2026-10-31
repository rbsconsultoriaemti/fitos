import { Router } from 'express';
import { wrap } from '../../shared/http';
import { requireAuth } from '../auth/auth.middleware';
import { requirePlatformAdmin, requirePortalHeader } from './portal.access';
import { foodIdParamSchema, foodPatchSchema, foodsQuerySchema } from './admin-catalog.schemas';
import * as catalog from './admin-catalog.service';

/** Catálogo de alimentos no portal (/portal/admin/foods). Só administrador da plataforma; escrita exige o cabeçalho do portal. */
export const adminCatalogRouter = Router();
adminCatalogRouter.use(requireAuth, requirePlatformAdmin);

adminCatalogRouter.get(
  '/foods',
  wrap(async (req, res) => {
    const q = foodsQuerySchema.parse(req.query);
    res.json(await catalog.listFoods({ q: q.q || undefined, page: q.page, hidden: q.hidden, glutenFree: q.glutenFree }));
  }),
);

adminCatalogRouter.patch(
  '/foods/:id',
  requirePortalHeader,
  wrap(async (req, res) => {
    const { id } = foodIdParamSchema.parse(req.params);
    const patch = foodPatchSchema.parse(req.body);
    res.json(await catalog.updateFood(req.account!.id, id, patch));
  }),
);

adminCatalogRouter.get(
  '/foods/:id/audit',
  wrap(async (req, res) => {
    const { id } = foodIdParamSchema.parse(req.params);
    res.json({ items: await catalog.listFoodAudit(id) });
  }),
);
