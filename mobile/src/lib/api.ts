import { API_URL } from './config';
import * as storage from './storage';
import type { AuthResponse } from './types';

const ACCESS_KEY = 'fitos.accessToken';
const REFRESH_KEY = 'fitos.refreshToken';

// Com sinal fraco o fetch pode ficar pendurado; depois deste tempo trata como "sem conexão".
const TIMEOUT_MS = 8000;

function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Campos extras da resposta de erro (ex.: `resetsAt` e `limit` no 429 `quota_exceeded`). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// ---------- tokens ----------

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export async function loadTokens() {
  [accessToken, refreshToken] = await Promise.all([storage.getItem(ACCESS_KEY), storage.getItem(REFRESH_KEY)]);
  return refreshToken !== null;
}

export async function saveTokens(auth: Pick<AuthResponse, 'accessToken' | 'refreshToken'> | null) {
  accessToken = auth?.accessToken ?? null;
  refreshToken = auth?.refreshToken ?? null;
  await Promise.all([storage.setItem(ACCESS_KEY, accessToken), storage.setItem(REFRESH_KEY, refreshToken)]);
}

export function getRefreshToken() {
  return refreshToken;
}

/** Chamado quando o refresh falha de vez (token expirado/revogado): a sessão precisa ser encerrada. */
export function setSessionLostHandler(fn: (() => void) | null) {
  onSessionLost = fn;
}

// ---------- requisições ----------

// O refresh token é de uso único (rotação): requisições simultâneas precisam compartilhar UMA chamada,
// senão a segunda reapresenta um token já usado e o backend revoga a sessão inteira.
let refreshing: Promise<'ok' | 'rejected' | 'network'> | null = null;

function refreshSession() {
  refreshing ??= (async () => {
    if (!refreshToken) return 'rejected' as const;
    try {
      const res = await fetchWithTimeout(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return 'rejected' as const;
      await saveTokens((await res.json()) as AuthResponse);
      return 'ok' as const;
    } catch {
      return 'network' as const;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function parse(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /** Corpo binário (ex.: foto) em vez de JSON. */
  raw?: { body: Blob; contentType: string };
  timeoutMs?: number;
}

export async function api<T>(
  path: string,
  { method = 'GET', body, auth = true, raw, timeoutMs }: Options = {},
): Promise<T> {
  const send = () =>
    fetchWithTimeout(
      `${API_URL}${path}`,
      {
        method,
        headers: {
          ...(raw ? { 'Content-Type': raw.contentType } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: raw ? raw.body : body !== undefined ? JSON.stringify(body) : undefined,
      },
      timeoutMs,
    );

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && auth) {
      const outcome = await refreshSession();
      if (outcome === 'ok') {
        res = await send();
      } else if (outcome === 'network') {
        // Sem sinal: mantém a sessão (tokens) e deixa o app seguir offline.
        throw new TypeError('network');
      } else {
        await saveTokens(null);
        onSessionLost?.();
      }
    }
  } catch {
    throw new ApiError(0, 'network', `Não foi possível conectar ao servidor (${API_URL}). Ele está rodando?`);
  }

  const data = await parse(res);
  if (!res.ok) {
    const issue = data?.issues?.[0];
    const message =
      data?.message ?? (issue ? `${issue.path?.join('.') || 'campo'}: ${issue.message}` : `Erro ${res.status}`);
    throw new ApiError(res.status, data?.error ?? 'error', message, data && typeof data === 'object' ? data : undefined);
  }
  return data as T;
}
