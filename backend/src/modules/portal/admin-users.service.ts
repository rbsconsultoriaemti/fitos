import { Pool, PoolClient } from 'pg';
import { pool } from '../../database/pool';
import { AppError } from '../../shared/errors';
import { PAGE_SIZE } from './admin-users.schemas';

// Nunca selecionar password_hash nem tokens: estas colunas são as únicas que saem daqui.
const USER_COLUMNS = 'u.id, u.name, u.email, u.role, u.is_active, u.is_platform_admin, u.created_at';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  is_platform_admin: boolean;
  created_at: Date;
}

const present = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  isActive: u.is_active,
  isPlatformAdmin: u.is_platform_admin,
  createdAt: u.created_at,
});

/** Escapa % _ \ para que o texto digitado seja buscado literalmente no ILIKE. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listUsers(q: string | undefined, page: number) {
  const pattern = q ? `%${likeEscape(q)}%` : null;
  const where = pattern ? "WHERE u.name ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\'" : '';
  const params = pattern ? [pattern] : [];
  const total = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM users u ${where}`, params)).rows[0].n);
  const { rows } = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users u ${where} ORDER BY u.created_at DESC, u.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  return { items: rows.map(present), page, pageSize: PAGE_SIZE, total };
}

async function activeAdminCount(db: Pool | PoolClient): Promise<number> {
  const { rows } = await db.query<{ n: string }>('SELECT count(*) AS n FROM users WHERE is_platform_admin AND is_active');
  return Number(rows[0].n);
}

/** Motivos (texto para a tela) pelos quais cada ação está proibida para este alvo; null = permitida. O backend decide. */
function protections(actorId: string, target: UserRow, adminCount: number) {
  const self = actorId === target.id;
  return {
    roleChange: self ? 'Você não pode trocar o seu próprio papel.' : null,
    deactivate: self
      ? 'Você não pode desativar a sua própria conta.'
      : target.is_active && target.is_platform_admin && adminCount <= 1
        ? 'Esta é a última conta de administrador da plataforma ativa.'
        : null,
  };
}

export async function getUser(actorId: string, id: string) {
  const { rows } = await pool.query<UserRow & { weight_kg: string | null; height_cm: string | null; goal: string | null; fitness_level: string | null; last_access_at: Date | null }>(
    `SELECT ${USER_COLUMNS}, p.weight_kg, p.height_cm, p.goal, p.fitness_level,
            (SELECT max(created_at) FROM refresh_tokens r WHERE r.user_id = u.id) AS last_access_at
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.id = $1`,
    [id],
  );
  const u = rows[0];
  if (!u) throw new AppError(404, 'user_not_found', 'Usuário não encontrado');
  const hasProfile = u.weight_kg !== null || u.height_cm !== null || !!u.goal || !!u.fitness_level;
  return {
    ...present(u),
    profile: hasProfile
      ? { weightKg: u.weight_kg === null ? null : Number(u.weight_kg), heightCm: u.height_cm === null ? null : Number(u.height_cm), goal: u.goal, fitnessLevel: u.fitness_level }
      : null,
    // Aproximação: o sistema não guarda "último login"; vale o último login ou renovação de sessão.
    lastAccessAt: u.last_access_at,
    protections: protections(actorId, u, await activeAdminCount(pool)),
  };
}

export async function updateUser(actorId: string, id: string, patch: { role?: string; isActive?: boolean }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Trava os administradores ativos (is_platform_admin e is_active) até o COMMIT: duas desativações simultâneas
    // se enfileiram aqui, e a segunda já enxerga o resultado da primeira.
    const locked = await client.query<{ id: string }>('SELECT id FROM users WHERE is_platform_admin AND is_active ORDER BY id FOR UPDATE');
    const activeAdminIds = locked.rows.map((r) => r.id);
    const { rows } = await client.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1 FOR UPDATE`, [id]);
    const target = rows[0];
    if (!target) throw new AppError(404, 'user_not_found', 'Usuário não encontrado');

    const roleChanges = patch.role !== undefined && patch.role !== target.role;
    const activeChanges = patch.isActive !== undefined && patch.isActive !== target.is_active;
    const lock = protections(actorId, target, await activeAdminCount(client));
    if (roleChanges && lock.roleChange) throw new AppError(409, 'self_role_change', lock.roleChange);
    if (patch.isActive === false && activeChanges && actorId === target.id) throw new AppError(409, 'self_deactivate', lock.deactivate ?? 'Você não pode desativar a sua própria conta.');
    // Depois desta alteração sobraria algum administrador ativo? Se não, recusa e nada é gravado (ROLLBACK).
    if (patch.isActive === false && activeChanges && activeAdminIds.includes(target.id) && activeAdminIds.filter((a) => a !== target.id).length === 0) {
      throw new AppError(409, 'last_platform_admin', 'Não é possível desativar o último administrador da plataforma ativo.');
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (roleChanges) {
      before.role = target.role;
      after.role = patch.role;
    }
    if (activeChanges) {
      before.isActive = target.is_active;
      after.isActive = patch.isActive;
    }
    if (roleChanges || activeChanges) {
      await client.query('UPDATE users SET role = COALESCE($2::user_role, role), is_active = COALESCE($3, is_active) WHERE id = $1', [id, roleChanges ? patch.role : null, activeChanges ? patch.isActive : null]);
      // Conta desativada perde as sessões do portal e do app: refresh tokens revogados na hora.
      if (activeChanges && patch.isActive === false) await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      const action = roleChanges && activeChanges ? 'update' : roleChanges ? 'role_change' : patch.isActive ? 'activate' : 'deactivate';
      await client.query('INSERT INTO admin_audit_log (actor_id, target_user_id, action, before, after) VALUES ($1, $2, $3, $4, $5)', [actorId, id, action, before, after]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return getUser(actorId, id);
}

const ROLE_PT: Record<string, string> = {
  student: 'aluno',
  trainer: 'professor de Ed. Física',
  running_coach: 'treinador de corrida',
  cycling_coach: 'treinador de ciclismo',
  nutritionist: 'nutricionista',
  psychologist: 'psicólogo',
  admin: 'administrador',
};
const rolePt = (r: unknown) => ROLE_PT[String(r)] ?? String(r);

/** Texto legível de cada linha da auditoria (a tela mostra isto; nunca uma linha vazia). */
function describeAudit(r: { action: string; before: Record<string, unknown>; after: Record<string, unknown>; actor_name: string | null; target_role: string | null; target_council: string | null; target_number: string | null }): string {
  const by = `por ${r.actor_name ?? 'conta removida'}`;
  const reg = r.target_council ? ` (${r.target_council === 'SEM_CONSELHO' ? 'sem conselho' : `${r.target_council} ${r.target_number ?? ''}`.trim()})` : '';
  switch (r.action) {
    case 'professional_validate':
      return `Validado como ${rolePt(r.target_role)}${reg} ${by}`;
    case 'professional_reject':
      return `Rejeitado como ${rolePt(r.target_role)}${reg} ${by}`;
    case 'role_change':
    case 'activate':
    case 'deactivate':
    case 'update': {
      const parts: string[] = [];
      if (r.after.role !== undefined) parts.push(`Papel alterado de ${rolePt(r.before.role)} para ${rolePt(r.after.role)}`);
      if (r.after.isActive !== undefined) parts.push(r.after.isActive ? 'Conta ativada' : 'Conta desativada');
      return `${parts.join(' e ') || 'Conta alterada'} ${by}`;
    }
    default:
      return `Alteração (${r.action}) ${by}`;
  }
}

export async function listAudit(userId: string | undefined, page: number) {
  const where = userId ? 'WHERE a.target_user_id = $1' : '';
  const params = userId ? [userId] : [];
  const total = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM admin_audit_log a ${where}`, params)).rows[0].n);
  const { rows } = await pool.query(
    `SELECT a.id, a.actor_id, actor.name AS actor_name, actor.email AS actor_email, a.target_user_id, a.action, a.before, a.after, a.created_at,
            tgt.role AS target_role, tgt.registration_council AS target_council, tgt.registration_number AS target_number
       FROM admin_audit_log a
       LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN users tgt ON tgt.id = a.target_user_id
       ${where} ORDER BY a.created_at DESC, a.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      actorEmail: r.actor_email,
      targetUserId: r.target_user_id,
      action: r.action,
      before: r.before,
      after: r.after,
      description: describeAudit(r),
      createdAt: r.created_at,
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
}
