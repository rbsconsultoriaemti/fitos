import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { pool } from './database/pool';
import { authRouter } from './modules/auth/auth.routes';
import { invitesRouter } from './modules/auth/invites.routes';
import { AppError } from './shared/errors';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  app.use('/auth', authRouter);
  app.use('/invites', invitesRouter);
  // Próximos módulos entram aqui conforme forem construídos.

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'validation_error', issues: err.issues });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
