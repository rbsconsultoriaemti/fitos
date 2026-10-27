import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../../shared/http';
import { requireAuth } from '../auth/auth.middleware';
import { FOOD_CATALOG, FOOD_CATALOG_KEYS } from './food-catalog';
import { getFoodPreferences, saveFoodPreferences } from './preferences.service';

export const preferencesRouter = Router();
preferencesRouter.use(requireAuth);

const keys = z.array(z.string().max(60)).max(FOOD_CATALOG.length);

// Só os itens com gosto/não gosto; o que não vier é "indiferente". Chaves fora do catálogo, repetidas ou
// presentes nas duas listas são recusadas (400).
export const putFoodPreferencesSchema = z
  .strictObject({ likes: keys, dislikes: keys })
  .superRefine((b, ctx) => {
    const all = [...b.likes, ...b.dislikes];
    const unknown = all.filter((k) => !FOOD_CATALOG_KEYS.has(k));
    if (unknown.length) ctx.addIssue({ code: 'custom', message: `Itens desconhecidos: ${[...new Set(unknown)].join(', ')}` });
    if (new Set(all).size !== all.length) ctx.addIssue({ code: 'custom', message: 'Item repetido (ou marcado como gosto e não gosto ao mesmo tempo)' });
  });

preferencesRouter.get(
  '/foods',
  wrap(async (req, res) => {
    res.json(await getFoodPreferences(req.auth!.sub));
  }),
);

preferencesRouter.put(
  '/foods',
  wrap(async (req, res) => {
    const { likes, dislikes } = putFoodPreferencesSchema.parse(req.body);
    res.json(await saveFoodPreferences(req.auth!.sub, likes, dislikes));
  }),
);
