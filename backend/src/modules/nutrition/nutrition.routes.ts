import express, { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { wrap } from '../../shared/http';
import { requireAuth, requireRole } from '../auth/auth.middleware';
import {
  createFoodSchema,
  createLogSchema,
  createPlanSchema,
  listFoodsSchema,
  listLogsSchema,
  listPlansSchema,
  setPortionsSchema,
  updateLogSchema,
  updatePlanSchema,
} from './nutrition.schemas';
import * as service from './nutrition.service';
import { recognizeMeal } from './recognition.service';

const idParam = z.object({ id: z.uuid() });
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const nutritionRouter = Router();
nutritionRouter.use(requireAuth);

// Alimentos (TACO + personalizados)
nutritionRouter.get(
  '/foods',
  wrap(async (req, res) => {
    res.json(await service.listFoods(listFoodsSchema.parse(req.query)));
  }),
);
nutritionRouter.get(
  '/foods/:id',
  wrap(async (req, res) => {
    res.json(await service.getFood(idParam.parse(req.params).id));
  }),
);
nutritionRouter.post(
  '/foods',
  requireRole('nutritionist', 'admin'),
  wrap(async (req, res) => {
    res.status(201).json(await service.createFood(createFoodSchema.parse(req.body)));
  }),
);

nutritionRouter.patch(
  '/foods/:id/portions',
  requireRole('nutritionist', 'admin'),
  wrap(async (req, res) => {
    res.json(await service.setFoodPortions(idParam.parse(req.params).id, setPortionsSchema.parse(req.body).portions));
  }),
);

// Planos alimentares
nutritionRouter.post(
  '/plans',
  wrap(async (req, res) => {
    res.status(201).json(await service.createPlan(req.auth!, createPlanSchema.parse(req.body)));
  }),
);
nutritionRouter.get(
  '/plans',
  wrap(async (req, res) => {
    res.json(await service.listPlans(req.auth!, listPlansSchema.parse(req.query)));
  }),
);
nutritionRouter.get(
  '/plans/:id',
  wrap(async (req, res) => {
    res.json(await service.getPlan(req.auth!, idParam.parse(req.params).id));
  }),
);
nutritionRouter.put(
  '/plans/:id',
  wrap(async (req, res) => {
    res.json(await service.updatePlan(req.auth!, idParam.parse(req.params).id, updatePlanSchema.parse(req.body)));
  }),
);
nutritionRouter.post(
  '/plans/:id/approve',
  requireRole('nutritionist'),
  wrap(async (req, res) => {
    res.json(await service.approvePlan(req.auth!, idParam.parse(req.params).id));
  }),
);
nutritionRouter.post(
  '/plans/:id/archive',
  wrap(async (req, res) => {
    res.json(await service.archivePlan(req.auth!, idParam.parse(req.params).id));
  }),
);

// Reconhecimento por foto: corpo = bytes da imagem (Content-Type image/jpeg|png|webp). Não registra nada.
nutritionRouter.post(
  '/recognize',
  express.raw({ type: IMAGE_TYPES, limit: '8mb' }),
  wrap(async (req, res) => {
    const mime = req.headers['content-type']?.split(';')[0];
    if (!mime || !IMAGE_TYPES.includes(mime) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(415, 'unsupported_image_type', 'Envie a imagem (jpeg, png ou webp) no corpo da requisição');
    }
    res.json(await recognizeMeal(req.body, mime));
  }),
);

// Log de comida
nutritionRouter.post(
  '/logs',
  wrap(async (req, res) => {
    res.status(201).json(await service.createLogs(req.auth!, createLogSchema.parse(req.body)));
  }),
);
nutritionRouter.get(
  '/logs',
  wrap(async (req, res) => {
    res.json(await service.getDayLog(req.auth!, listLogsSchema.parse(req.query)));
  }),
);
nutritionRouter.patch(
  '/logs/:id',
  wrap(async (req, res) => {
    res.json(await service.updateLog(req.auth!, idParam.parse(req.params).id, updateLogSchema.parse(req.body)));
  }),
);
nutritionRouter.delete(
  '/logs/:id',
  wrap(async (req, res) => {
    await service.deleteLog(req.auth!, idParam.parse(req.params).id);
    res.status(204).end();
  }),
);
