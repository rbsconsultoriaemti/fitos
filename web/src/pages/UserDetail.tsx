import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ASSIGNABLE_ROLES, ROLE_LABELS, describeError, getAdminUser, listAudit, patchAdminUser, type AdminUserDetail, type AuditEntry, type Role } from '../api';
import ErrorNotice from '../ErrorNotice';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

function describeChange(e: AuditEntry): string {
  const parts: string[] = [];
  if (e.after.role !== undefined) parts.push(`papel: ${e.before.role ? ROLE_LABELS[e.before.role] : '?'} → ${ROLE_LABELS[e.after.role]}`);
  if (e.after.isActive !== undefined) parts.push(e.after.isActive ? 'conta ativada' : 'conta desativada');
  return parts.join(' · ');
}

export default function UserDetail() {
  const { id = '' } = useParams();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, a] = await Promise.all([getAdminUser(id), listAudit(id)]);
      setUser(u);
      setAudit(a.items);
    } catch (e) {
      setUser(null);
      setError(e);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function change(body: { role?: Role; isActive?: boolean }) {
    setActionError(null);
    setBusy(true);
    try {
      await patchAdminUser(id, body);
      await load();
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const back = <Link to="/usuarios">← Usuários e papéis</Link>;
  if (error) {
    return (
      <>
        {back}
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!user) {
    return (
      <>
        {back}
        <p className="muted">Carregando…</p>
      </>
    );
  }

  const { protections } = user;
  const roleOptions: Role[] = ASSIGNABLE_ROLES.includes(user.role) ? ASSIGNABLE_ROLES : [user.role, ...ASSIGNABLE_ROLES];
  const profile = user.profile
    ? [user.profile.weightKg !== null && `${user.profile.weightKg} kg`, user.profile.heightCm !== null && `${user.profile.heightCm} cm`, user.profile.goal, user.profile.fitnessLevel].filter(Boolean).join(' · ')
    : '';

  return (
    <>
      {back}
      <h1>{user.name}</h1>
      <div className="card">
        <dl className="facts">
          <dt>E-mail</dt>
          <dd>{user.email}</dd>
          <dt>Papel</dt>
          <dd>{ROLE_LABELS[user.role]}</dd>
          <dt>Conta ativa</dt>
          <dd>{user.isActive ? 'Sim' : 'Não'}</dd>
          <dt>Administrador da plataforma</dt>
          <dd>
            {user.isPlatformAdmin ? 'Sim' : 'Não'} <span className="muted">(somente leitura; só muda pelo script do servidor)</span>
          </dd>
          <dt>Criada em</dt>
          <dd>{when(user.createdAt)}</dd>
          <dt>Último acesso</dt>
          <dd>{when(user.lastAccessAt)}</dd>
          {profile ? (
            <>
              <dt>Perfil</dt>
              <dd>{profile}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="card grid">
        <h2>Ações</h2>
        <div className="field">
          <label htmlFor="role">Papel</label>
          <div className="inline">
            <select id="role" value={user.role} disabled={busy || !!protections.roleChange} onChange={(e) => void change({ role: e.target.value as Role })}>
              {roleOptions.map((r) => (
                <option key={r} value={r} disabled={!ASSIGNABLE_ROLES.includes(r)}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {protections.roleChange ? <span className="muted">{protections.roleChange}</span> : null}
          </div>
        </div>
        <div className="inline">
          {user.isActive ? (
            <button
              className="btn danger"
              disabled={busy || !!protections.deactivate}
              onClick={() => {
                if (window.confirm(`Desativar a conta de ${user.name}? Ela perde o acesso e as sessões abertas são encerradas.`)) void change({ isActive: false });
              }}
            >
              Desativar conta
            </button>
          ) : (
            <button className="btn" disabled={busy} onClick={() => void change({ isActive: true })}>
              Ativar conta
            </button>
          )}
          {user.isActive && protections.deactivate ? <span className="muted">{protections.deactivate}</span> : null}
        </div>
        {actionError ? (
          <p className="error" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>Histórico de alterações</h2>
        {audit.length === 0 ? (
          <p className="muted">Nenhuma alteração registrada.</p>
        ) : (
          <ul className="history">
            {audit.map((e) => (
              <li key={e.id}>
                <strong>{e.description || describeChange(e)}</strong>
                <span className="muted">{when(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
