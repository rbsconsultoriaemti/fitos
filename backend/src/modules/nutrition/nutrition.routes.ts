import express, { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { wrap } from '../../shared/http';
import { requireAuth, requireRole } from '../auth/auth.middleware';
import {
  applyTemplateSchema,
  barcodeParam,
  createWaterSchema,
  createFoodSchema,
  createLogSchema,
  createPlanSchema,
  createTemplateSchema,
  energyTargetQuerySchema,
  listFoodsSchema,
  listLogsSchema,
  listPlansSchema,
  setEnergyTargetSchema,
  setPortionsSchema,
  updateLogSchema,
  updatePlanSchema,
  waterTodaySchema,
} from './nutrition.schemas';
import { computeEnergyTarget, setEnergyOverride } from './energy.service';
import * as service from './nutrition.service';
import * as templates from './templates.service';
import { requireQuota } from '../quotas/quotas.middleware';
import { consumeQuota } from '../quotas/quotas.service';
import { recognizeMeal } from './recognition.service';
import * as water from './water.service';

const idParam = z.object({ id: z.uuid() });
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const nutritionRouter = Router();
nutritionRouter.use(requireAuth);

// Alimentos (TACO + personalizados)
nutritionRouter.get(
  '/foods',
  wrap(async (req, res) => {
    res.json(await service.listFoods(listFoodsSchema.parse(req.query), req.auth!.sub));
  }),
);
nutritionRouter.get(
  '/foods/barcode/:code',
  wrap(async (req, res) => {
    res.json(await service.findFoodByBarcode(barcodeParam.parse(req.params).code));
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

// Reconhecimento por foto. Aceita JSON { imageBase64, mimeType } (usado pelo app) ou os bytes da imagem
// no corpo (Content-Type image/jpeg|png|webp). Não registra nada.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const recognizeJsonSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
  hints: z.string().trim().max(200).optional(),
});

nutritionRouter.post(
  '/recognize',
  requireQuota('photo_recognition'),
  express.raw({ type: IMAGE_TYPES, limit: '8mb' }),
  wrap(async (req, res) => {
    const contentType = req.headers['content-type']?.split(';')[0];
    let image: Buffer;
    let mime: string;
    let hints: string | undefined;
    if (contentType === 'application/json') {
      const body = recognizeJsonSchema.parse(req.body);
      // Aceita também o prefixo "data:image/jpeg;base64,".
      image = Buffer.from(body.imageBase64.replace(/^data:[^,]*,/, ''), 'base64');
      mime = body.mimeType;
      hints = body.hints || undefined;
    } else if (contentType && IMAGE_TYPES.includes(contentType) && Buffer.isBuffer(req.body)) {
      image = req.body;
      mime = contentType;
    } else {
      throw new AppError(415, 'unsupported_image_type', 'Envie a imagem (jpeg, png ou webp) em JSON base64 ou como corpo binário');
    }
    if (image.length === 0) throw new AppError(400, 'empty_image', 'A imagem chegou vazia. Tire a foto novamente.');
    if (image.length > MAX_IMAGE_BYTES) throw new AppError(413, 'image_too_large', 'Imagem muito grande (máx. 8 MB)');
    console.log(`[recognize] ${mime} ${image.length} bytes${hints ? `, com ingredientes (${hints.length} caracteres)` : ''}`);
    const result = await recognizeMeal(image, mime, hints, req.auth!.sub);
    await consumeQuota(req.auth!.sub, 'photo_recognition'); // só depois do sucesso da IA
    res.json(result);
  }),
);

// Água
nutritionRouter.post(
  '/water',
  wrap(async (req, res) => {
    const { duplicate, entry } = await water.addWater(req.auth!, createWaterSchema.parse(req.body));
    res.status(duplicate ? 200 : 201).json(entry);
  }),
);
nutritionRouter.get(
  '/water/today',
  wrap(async (req, res) => {
    res.json(await water.waterToday(req.auth!, waterTodaySchema.parse(req.query).date));
  }),
);
nutritionRouter.delete(
  '/water/:id',
  wrap(async (req, res) => {
    await water.deleteWater(req.auth!, idParam.parse(req.params).id);
    res.status(204).end();
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

// Refeições favoritas
nutritionRouter.post(
  '/templates',
  wrap(async (req, res) => {
    res.status(201).json(await templates.createTemplate(req.auth!, createTemplateSchema.parse(req.body)));
  }),
);
nutritionRouter.get(
  '/templates',
  wrap(async (req, res) => {
    res.json(await templates.listTemplates(req.auth!));
  }),
);
nutritionRouter.post(
  '/templates/:id/apply',
  wrap(async (req, res) => {
    res.status(201).json(await templates.applyTemplate(req.auth!, idParam.parse(req.params).id, applyTemplateSchema.parse(req.body ?? {})));
  }),
);
nutritionRouter.put(
  '/templates/:id',
  wrap(async (req, res) => {
    res.json(await templates.updateTemplate(req.auth!, idParam.parse(req.params).id, createTemplateSchema.parse(req.body)));
  }),
);
nutritionRouter.delete(
  '/templates/:id',
  wrap(async (req, res) => {
    await templates.deleteTemplate(req.auth!, idParam.parse(req.params).id);
    res.status(204).end();
  }),
);

// Meta de calorias (calculada pelo perfil e pelos treinos do dia; o usuário pode sobrescrever)
nutritionRouter.get(
  '/energy-target',
  wrap(async (req, res) => {
    const { date } = energyTargetQuerySchema.parse(req.query);
    const day = date ?? (await service.getDayLog(req.auth!, {})).date;
    res.json({ date: day, ...(await computeEnergyTarget(req.auth!.sub, day)) });
  }),
);
nutritionRouter.put(
  '/energy-target',
  wrap(async (req, res) => {
    await setEnergyOverride(req.auth!.sub, setEnergyTargetSchema.parse(req.body).overrideKcal);
    const day = (await service.getDayLog(req.auth!, {})).date;
    res.json({ date: day, ...(await computeEnergyTarget(req.auth!.sub, day)) });
  }),
);
