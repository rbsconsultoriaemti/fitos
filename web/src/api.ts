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

/** Papéis de negócio que a tela deixa escolher (lista só da interface; o backend valida e recusa `admin`). */
export const ASSIGNABLE_ROLES: Role[] = ['student', 'trainer', 'running_coach', 'cycling_coach', 'nutritionist', 'psychologist'];

export interface AdminUser extends User {
  isActive: boolean;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUser {
  profile: { weightKg: number | null; heightCm: number | null; goal: string | null; fitnessLevel: string | null } | null;
  lastAccessAt: string | null;
  /** Motivo (texto pronto) pelo qual a ação está proibida; null = permitida. Quem decide é o backend. */
  protections: { roleChange: string | null; deactivate: string | null };
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
  targetUserId: string;
  action: string;
  before: { role?: Role; isActive?: boolean };
  after: { role?: Role; isActive?: boolean };
  createdAt: string;
}

const PORTAL_WRITE = { 'X-Fitos-Portal': '1' };

export const listAdminUsers = (q: string, page: number) => api<Page<AdminUser>>(`/portal/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page) })}`);
export const getAdminUser = (id: string) => api<AdminUserDetail>(`/portal/admin/users/${id}`);
export const patchAdminUser = (id: string, body: { role?: Role; isActive?: boolean }) =>
  api<AdminUserDetail>(`/portal/admin/users/${id}`, { method: 'PATCH', headers: PORTAL_WRITE, body: JSON.stringify(body) });
export const listAudit = (userId: string) => api<Page<AuditEntry>>(`/portal/admin/audit?userId=${userId}`);
