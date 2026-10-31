import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { wrap } from '../../shared/http';
import { isAuthorized, processEvent, type RcEvent } from './revenuecat.service';

/** Cobrança e assinatura (/billing/*). Não usa sessão: o webhook do RevenueCat se autentica pelo cabeçalho Authorization. */
export const billingRouter = Router();

const webhookSchema = z.object({
  event: z.object({ id: z.string().min(1).max(200), type: z.string().min(1).max(60) }).passthrough(),
});

billingRouter.post(
  '/revenuecat/webhook',
  wrap(async (req, res) => {
    if (!isAuthorized(req.header('authorization'))) throw new AppError(401, 'invalid_webhook_auth', 'Não autorizado');
    const { event } = webhookSchema.parse(req.body);
    const outcome = await processEvent(event as unknown as RcEvent);
    res.status(200).json({ ok: true, outcome });
  }),
);
