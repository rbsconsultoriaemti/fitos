import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../../shared/http';
import { requireAuth, requireRole } from '../auth/auth.middleware';
import {
  createExerciseSchema,
  createLogSchema,
  createPlanSchema,
  listExercisesSchema,
  listLogsSchema,
  listPlansSchema,
  updatePlanSchema,
} from './workout.schemas';
import * as service from './workout.service';

const idParam = z.object({ id: z.uuid() });

export const workoutRouter = Router();
workoutRouter.use(requireAuth);

// Exercícios: catálogo compartilhado; professor e admin cadastram.
workoutRouter.post(
  '/exercises',
  requireRole('trainer', 'admin'),
  wrap(async (req, res) => {
    res.status(201).json(await service.createExercise(createExerciseSchema.parse(req.body)));
  }),
);
workoutRouter.get(
  '/exercises',
  wrap(async (req, res) => {
    res.json(await service.listExercises(listExercisesSchema.parse(req.query)));
  }),
);
workoutRouter.get(
  '/exercises/:id',
  wrap(async (req, res) => {
    res.json(await service.getExercise(idParam.parse(req.params).id));
  }),
);

// Planos
workoutRouter.post(
  '/plans',
  wrap(async (req, res) => {
    res.status(201).json(await service.createPlan(req.auth!, createPlanSchema.parse(req.body)));
  }),
);
workoutRouter.get(
  '/plans',
  wrap(async (req, res) => {
    res.json(await service.listPlans(req.auth!, listPlansSchema.parse(req.query)));
  }),
);
workoutRouter.get(
  '/plans/:id',
  wrap(async (req, res) => {
    res.json(await service.getPlan(req.auth!, idParam.parse(req.params).id));
  }),
);
workoutRouter.put(
  '/plans/:id',
  wrap(async (req, res) => {
    res.json(await service.updatePlan(req.auth!, idParam.parse(req.params).id, updatePlanSchema.parse(req.body)));
  }),
);
workoutRouter.post(
  '/plans/:id/approve',
  requireRole('trainer'),
  wrap(async (req, res) => {
    res.json(await service.approvePlan(req.auth!, idParam.parse(req.params).id));
  }),
);
workoutRouter.post(
  '/plans/:id/archive',
  wrap(async (req, res) => {
    res.json(await service.archivePlan(req.auth!, idParam.parse(req.params).id));
  }),
);

// Logs de execução
workoutRouter.post(
  '/logs',
  requireRole('student'),
  wrap(async (req, res) => {
    res.status(201).json(await service.createLog(req.auth!, createLogSchema.parse(req.body)));
  }),
);
workoutRouter.get(
  '/logs',
  wrap(async (req, res) => {
    res.json(await service.listLogs(req.auth!, listLogsSchema.parse(req.query)));
  }),
);
workoutRouter.get(
  '/logs/:id',
  wrap(async (req, res) => {
    res.json(await service.getLog(req.auth!, idParam.parse(req.params).id));
  }),
);
