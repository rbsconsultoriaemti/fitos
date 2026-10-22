import { randomUUID } from 'node:crypto';
import { config } from '../../shared/config';

/** Em produção os logs não carregam dados de saúde nem o prompt; só metadados e erros (com a resposta truncada). */
export const verbose = config.env !== 'production';

export interface OnboardingLogger {
  id: string;
  /** Só em desenvolvimento: payload, perfil, prompt e resposta bruta. */
  debug(event: string, data?: unknown): void;
  info(event: string, data?: unknown): void;
  warn(event: string, data?: unknown): void;
  error(event: string, data?: unknown): void;
}

const fmt = (data: unknown) => (data === undefined ? '' : ` ${typeof data === 'string' ? data : JSON.stringify(data, null, verbose ? 2 : 0)}`);

export function createLogger(userId: string): OnboardingLogger {
  const id = randomUUID().slice(0, 8);
  const tag = `[onboarding ${id} user=${userId.slice(0, 8)}]`;
  return {
    id,
    debug: (event, data) => {
      if (verbose) console.log(`${tag} ${event}${fmt(data)}`);
    },
    info: (event, data) => console.log(`${tag} ${event}${fmt(data)}`),
    warn: (event, data) => console.warn(`${tag} WARN ${event}${fmt(data)}`),
    error: (event, data) => console.error(`${tag} ERROR ${event}${fmt(data)}`),
  };
}

export const truncate = (text: string, max = 3000) => (text.length > max ? `${text.slice(0, max)}… [+${text.length - max} caracteres]` : text);
