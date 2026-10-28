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
export type ValidationStatus = 'pending' | 'approved' | 'rejected';

export interface PortalUser extends User {
  isPlatformAdmin: boolean;
  /** Profissional novo nasce 'pending' até o administrador validar. Alunos e contas antigas são 'approved'. */
  validationStatus: ValidationStatus;
}

/** Conselho de registro aceito por papel (espelha `shared/professional-registration.ts`; o backend valida de novo). */
export type Council = 'CRN' | 'CREF' | 'CRP' | 'SEM_CONSELHO';
export const COUNCILS_BY_ROLE: Partial<Record<Role, Council[]>> = {
  nutritionist: ['CRN'],
  psychologist: ['CRP'],
  trainer: ['CREF'],
  running_coach: ['CREF', 'SEM_CONSELHO'],
  cycling_coach: ['CREF', 'SEM_CONSELHO'],
};
/** Unidades da federação (UF) onde o registro foi emitido. Lista fixa; o backend valida o mesmo conjunto. */
export const BRAZIL_STATES: { code: string; name: string }[] = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapá' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceará' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espírito Santo' },
  { code: 'GO', name: 'Goiás' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Pará' },
  { code: 'PB', name: 'Paraíba' },
  { code: 'PR', name: 'Paraná' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piauí' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondônia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' },
];

export const COUNCIL_LABELS: Record<Council, string> = {
  CRN: 'CRN (nutrição)',
  CREF: 'CREF (educação física)',
  CRP: 'CRP (psicologia)',
  SEM_CONSELHO: 'Sem conselho',
};

/** Pode ver e usar a tela de convites: administrador, ou profissional já validado. */
export function canInvite(user: PortalUser): boolean {
  return user.isPlatformAdmin || (PROFESSIONAL_ROLES.includes(user.role) && user.validationStatus === 'approved');
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
  /** Texto pronto vindo do backend, já com o autor (ex.: "Validado como nutricionista (CRN 123) por Maria"). */
  description: string;
  createdAt: string;
}

const PORTAL_WRITE = { 'X-Fitos-Portal': '1' };

export const listAdminUsers = (q: string, page: number) => api<Page<AdminUser>>(`/portal/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page) })}`);
export const getAdminUser = (id: string) => api<AdminUserDetail>(`/portal/admin/users/${id}`);
export const patchAdminUser = (id: string, body: { role?: Role; isActive?: boolean }) =>
  api<AdminUserDetail>(`/portal/admin/users/${id}`, { method: 'PATCH', headers: PORTAL_WRITE, body: JSON.stringify(body) });
export const listAudit = (userId: string) => api<Page<AuditEntry>>(`/portal/admin/audit?userId=${userId}`);

// ---- Convites ----

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Invite {
  id: string;
  role: Role;
  email: string | null;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdBy?: { id: string; name: string };
}

/** Só na resposta da criação: o link (com o token) nunca mais aparece depois. */
export interface CreatedInvite {
  id: string;
  role: Role;
  email: string | null;
  expiresAt: string;
  link: string;
}

/** Dados públicos de um convite, para a tela de aceitação. */
export interface InvitePreview {
  role: Role;
  expiresAt: string;
  invitedBy: string;
  requiresEmail: boolean;
  requiresRegistration: boolean;
}

export interface AcceptInviteBody {
  name: string;
  email: string;
  password: string;
  registrationCouncil?: Council;
  registrationNumber?: string;
  /** UF onde o registro foi emitido (obrigatória para profissional). */
  registrationState?: string;
}

export const INVITE_STATUS_LABELS: Record<InviteStatus, string> = {
  pending: 'Pendente',
  accepted: 'Aceito',
  expired: 'Expirado',
  revoked: 'Revogado',
};

export const createInvite = (body: { role: Role; email?: string; expiresInDays?: number }) =>
  api<CreatedInvite>('/portal/invites', { method: 'POST', headers: PORTAL_WRITE, body: JSON.stringify(body) });
export const listInvites = (page: number) => api<Page<Invite>>(`/portal/invites?page=${page}`);
export const revokeInvite = (id: string) => api<Invite>(`/portal/invites/${id}/revoke`, { method: 'POST', headers: PORTAL_WRITE });
/** Público (sem sessão). */
export const describeInvite = (token: string) => request<InvitePreview>(`/portal/invites/token/${encodeURIComponent(token)}`, {}, false);
/** Público (sem sessão). O papel vem do convite no servidor, não daqui. */
export const acceptInvite = (token: string, body: AcceptInviteBody) =>
  request<{ user: { id: string; name: string; email: string; role: Role; validationStatus: ValidationStatus } }>(
    `/portal/invites/token/${encodeURIComponent(token)}/accept`,
    { method: 'POST', headers: PORTAL_WRITE, body: JSON.stringify(body) },
    false,
  );

// ---- Validação de profissionais (somente administrador) ----

export interface PendingProfessional {
  id: string;
  name: string;
  email: string;
  role: Role;
  registrationCouncil: Council | null;
  registrationNumber: string | null;
  registrationState: string | null;
  createdAt: string;
}

export const listPendingProfessionals = (page: number) => api<Page<PendingProfessional>>(`/portal/admin/professionals/pending?page=${page}`);
export const decideProfessional = (id: string, decision: 'validate' | 'reject') =>
  api<{ id: string; validationStatus: ValidationStatus }>(`/portal/admin/professionals/${id}/${decision}`, { method: 'POST', headers: PORTAL_WRITE });
