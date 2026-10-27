import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { pool } from './database/pool';
import { authRouter } from './modules/auth/auth.routes';
import { invitesRouter } from './modules/auth/invites.routes';
import { nutritionRouter } from './modules/nutrition/nutrition.routes';
import { onboardingRouter } from './modules/onboarding/onboarding.routes';
import { quotasRouter } from './modules/quotas/quotas.routes';
import { preferencesRouter } from './modules/preferences/preferences.routes';
import { profileRouter } from './modules/profile/profile.routes';
import { trainerRouter } from './modules/trainer/trainer.routes';
import { workoutRouter } from './modules/workout/workout.routes';
import { config } from './shared/config';
import { AppError } from './shared/errors';

function describeDatabaseTarget() {
  try {
    const u = new URL(config.databaseUrl);
    return { host: u.hostname, port: u.port || '5432', database: u.pathname.slice(1), user: u.username };
  } catch {
    return config.databaseUrl ? 'DATABASE_URL inválida (não é uma URL)' : 'DATABASE_URL vazia';
  }
}

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  // Foto em base64 (JSON) precisa de limite maior que o padrão de 100 kb; vem antes do parser global.
  app.use('/nutrition/recognize', express.json({ limit: '12mb' }));
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch (err) {
      // Detalhe só no log do servidor (a resposta pública não expõe nada); nunca loga a senha da URL.
      const e = err as NodeJS.ErrnoException & { code?: string };
      console.error('[health] falha ao conectar no PostgreSQL:', {
        message: e.message,
        code: e.code,
        errors: err instanceof AggregateError ? err.errors.map((x) => ({ message: x.message, code: x.code })) : undefined,
        target: describeDatabaseTarget(),
      });
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  app.use('/auth', authRouter);
  app.use('/invites', invitesRouter);
  app.use('/workout', workoutRouter);
  app.use('/nutrition', nutritionRouter);
  app.use('/profile', profileRouter);
  app.use('/onboarding', onboardingRouter);
  app.use('/trainer', trainerRouter);
  app.use('/quotas', quotasRouter);
  app.use('/preferences', preferencesRouter);
  // Próximos módulos entram aqui conforme forem construídos.

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'validation_error', issues: err.issues });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}), ...err.extra });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
