import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../../shared/http';
import { requireAuth, requireRole } from '../auth/auth.middleware';
import { requireValidatedProfessional } from '../portal/portal.access';
import * as service from './trainer.service';
import { suggestPlan } from './trainer.suggest';

export const trainerRouter = Router();
trainerRouter.use(requireAuth, requireRole('trainer'), requireValidatedProfessional);

// Home do professor: alunos vinculados com o status de hoje + resumo.
trainerRouter.get(
  '/students',
  wrap(async (req, res) => {
    res.json(await service.listStudents(req.auth!.sub));
  }),
);

// Perfil do aluno visto pelo professor (precisa de vínculo ativo; senão 404).
trainerRouter.get(
  '/students/:id',
  wrap(async (req, res) => {
    res.json(await service.studentDetail(req.auth!.sub, z.object({ id: z.uuid() }).parse(req.params).id));
  }),
);

// Sugestão de treino pela IA a partir do perfil do aluno. Não grava nada: o professor revisa e envia depois.
trainerRouter.post(
  '/students/:id/suggest-plan',
  wrap(async (req, res) => {
    res.json(await suggestPlan(req.auth!.sub, z.object({ id: z.uuid() }).parse(req.params).id));
  }),
);
