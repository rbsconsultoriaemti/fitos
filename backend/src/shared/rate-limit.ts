import { NextFunction, Request, Response } from 'express';
import { AppError } from './errors';

/**
 * Limite de requisições em memória (janela deslizante simples). Vale para UMA instância da API; ao rodar mais de uma,
 * migrar para Redis (mesma observação da trava de cotas). Conta todas as tentativas, inclusive as que falham.
 */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string; code?: string; message?: string }) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();

  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - lastSweep > opts.windowMs) {
      lastSweep = now;
      for (const [k, list] of hits) if (list.every((t) => now - t >= opts.windowMs)) hits.delete(k);
    }
    const key = opts.key(req);
    const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (recent.length >= opts.max) {
      const retryAfterSec = Math.ceil((opts.windowMs - (now - recent[0])) / 1000);
      return next(new AppError(429, opts.code ?? 'rate_limited', opts.message ?? 'Muitas tentativas. Tente novamente mais tarde.', undefined, { retryAfterSec }));
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
