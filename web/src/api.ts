export type Role = 'student' | 'trainer' | 'running_coach' | 'cycling_coach' | 'nutritionist' | 'psychologist' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Papéis de profissional. Só para rotular a conta na tela inicial: quem decide acesso é o backend, rota por rota. */
export const PROFESSIONAL_ROLES: Role[] = ['trainer', 'running_coach', 'cycling_coach', 'nutritionist', 'psychologist'];

/** Resposta de `GET /portal/me`: a conta conferida no banco. */
export interface PortalUser extends User {
  isPlatformAdmin: boolean;
}

export const ROLE_LABELS: Record<Role, string> = {
  student: 'Aluno',
  trainer: 'Professor de Ed. Física',
  running_coach: 'Treinador de corrida',
  cycling_coach: 'Treinador de ciclismo',
  nutritionist: 'Nutricionista',
  psychologist: 'Psicólogo',
  admin: 'Administrador',
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// O access token vive SÓ nesta variável (memória da aba). Nada em localStorage/sessionStorage. O refresh token fica
// num cookie httpOnly que o JavaScript não consegue ler; ele é enviado pelo navegador apenas para /portal/*.
let accessToken: string | null = null;

const PORTAL_HEADER = { 'X-Fitos-Portal': '1' };

async function parse(res: Response) {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* corpo que não é JSON */
  }
  return body as { error?: string; message?: string } | null;
}

async function request<T>(path: string, init: RequestInit = {}, withToken = true): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (withToken && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const body = await parse(res);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'error', body?.message ?? 'Não foi possível concluir a operação');
  return body as T;
}

interface Session {
  user: User;
  accessToken: string;
}

export async function login(email: string, password: string): Promise<User> {
  const s = await request<Session>('/portal/login', { method: 'POST', headers: PORTAL_HEADER, body: JSON.stringify({ email, password }) }, false);
  accessToken = s.accessToken;
  return s.user;
}

// Várias chamadas ao mesmo tempo (ex.: React StrictMode em desenvolvimento) compartilham UM refresh. O refresh token
// é de uso único: usar o mesmo cookie duas vezes seria tratado como roubo e derrubaria a sessão.
let refreshing: Promise<User | null> | null = null;

/** Troca o cookie de refresh por um novo access token. Devolve null se não há sessão válida. */
export function refreshSession(): Promise<User | null> {
  refreshing ??= request<Session>('/portal/refresh', { method: 'POST', headers: PORTAL_HEADER }, false)
    .then((s) => {
      accessToken = s.accessToken;
      return s.user;
    })
    .catch(() => {
      accessToken = null;
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function logout(): Promise<void> {
  accessToken = null;
  await request<void>('/portal/logout', { method: 'POST', headers: PORTAL_HEADER }, false).catch(() => undefined);
}

/** Chamada autenticada à API. Se o access token expirou (401), renova uma vez e repete. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    if (!(await refreshSession())) throw err;
    return request<T>(path, init);
  }
}

/** Verificação real da sessão: o backend confere no banco que a conta existe e está ativa e informa o marcador de administrador. */
export const fetchPortalUser = () => api<PortalUser>('/portal/me');

/** Texto para mostrar quando uma chamada falha; 403 (rota sem permissão para esta conta) nunca vira tela em branco. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'Sua conta não tem permissão para acessar esta área.';
  if (err instanceof ApiError && err.status === 401) return 'Sua sessão expirou. Entre novamente.';
  return err instanceof Error ? err.message : 'Não foi possível concluir a operação.';
}
