import { NextFunction, Request, Response } from 'express';

type Handler = (req: Request, res: Response) => Promise<void>;

/** Encaminha rejeições de handlers async para o error handler do Express. */
export const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};
