import { NextFunction, Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { QuotaKind, assertQuota } from './quotas.service';

// Uma requisição por usuário e recurso por vez: duas em paralelo passariam pela mesma checagem e gastariam 2 chamadas de IA.
const inFlight = new Set<string>();

/**
 * Checa a cota ANTES da rota (429 `quota_exceeded` se esgotada). Não consome: a rota chama `consumeQuota`
 * só depois do sucesso da IA, então uma falha da IA não gasta cota.
 */
export const requireQuota = (kind: QuotaKind) => (req: Request, res: Response, next: NextFunction) => {
  const key = `${req.auth!.sub}:${kind}`;
  if (inFlight.has(key)) return next(new AppError(429, 'request_in_progress', 'Já existe uma solicitação em andamento. Aguarde ela terminar.'));
  assertQuota(req.auth!.sub, kind).then(
    () => {
      inFlight.add(key);
      res.once('close', () => inFlight.delete(key));
      next();
    },
    next,
  );
};
