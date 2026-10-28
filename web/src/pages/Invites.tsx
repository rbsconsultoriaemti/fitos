import { useEffect, useState, type FormEvent } from 'react';
import { ASSIGNABLE_ROLES, createInvite, describeError, INVITE_STATUS_LABELS, listInvites, revokeInvite, ROLE_LABELS, type CreatedInvite, type Invite, type Page, type Role } from '../api';
import ErrorNotice from '../ErrorNotice';

const VALIDITY_DAYS = [1, 3, 7, 14];

/** Convites: criar (link mostrado uma única vez), listar e revogar. Administrador e profissional validado. */
export default function Invites() {
  const [role, setRole] = useState<Role>('student');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const [page, setPage] = useState(1);
  const [list, setList] = useState<Page<Invite> | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    setListError(null);
    listInvites(page)
      .then((d) => alive && setList(d))
      .catch((e) => alive && (setList(null), setListError(e)));
    return () => {
      alive = false;
    };
  }, [page, version]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setCopied(false);
    try {
      const c = await createInvite({ role, ...(email.trim() ? { email: email.trim() } : {}), expiresInDays: days });
      setCreated(c);
      setEmail('');
      setPage(1);
      setVersion((v) => v + 1);
    } catch (err) {
      setFormError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeInvite(id);
      setVersion((v) => v + 1);
    } catch (err) {
      setListError(err);
    }
  };

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <>
      <h1>Convites</h1>

      <form className="card" style={{ display: 'grid', gap: 16 }} onSubmit={submit}>
        <h2>Novo convite</h2>
        <div className="field">
          <label htmlFor="inv-role">Papel</label>
          <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inv-email">E-mail do convidado (opcional)</label>
          <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
          <span className="muted">Se preenchido, só quem usar este e-mail consegue aceitar o convite.</span>
        </div>
        <div className="field">
          <label htmlFor="inv-days">Validade</label>
          <select id="inv-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {VALIDITY_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? 'dia' : 'dias'}
              </option>
            ))}
          </select>
        </div>
        {formError ? <p className="error">{formError}</p> : null}
        <div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Criando…' : 'Criar convite'}
          </button>
        </div>
      </form>

      {created ? (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <h2>Link do convite</h2>
          <p className="muted">Este link aparece só agora. Copie e envie ao convidado; depois de sair desta tela não é possível vê-lo de novo.</p>
          <div className="searchbar">
            <input aria-label="Link do convite" readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" type="button" onClick={() => void copy()}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="muted">
            {ROLE_LABELS[created.role]}
            {created.email ? ` · para ${created.email}` : ''} · vale até {new Date(created.expiresAt).toLocaleString('pt-BR')}
          </p>
        </div>
      ) : null}

      <h2>Convites emitidos</h2>
      {listError ? <ErrorNotice error={listError} /> : null}
      {!listError && !list ? <p className="muted">Carregando…</p> : null}
      {list ? (
        <div className="card tablecard">
          {list.items.length === 0 ? (
            <p className="empty muted">Nenhum convite emitido ainda.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Papel</th>
                  <th>E-mail</th>
                  <th>Criado por</th>
                  <th>Situação</th>
                  <th>Vale até</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((i) => (
                  <tr key={i.id}>
                    <td>{ROLE_LABELS[i.role]}</td>
                    <td>{i.email ?? <span className="muted">qualquer e-mail</span>}</td>
                    <td>{i.createdBy?.name ?? '—'}</td>
                    <td>{INVITE_STATUS_LABELS[i.status]}</td>
                    <td>{new Date(i.expiresAt).toLocaleDateString('pt-BR')}</td>
                    <td>
                      {i.status === 'pending' ? (
                        <button className="btn ghost danger-text" type="button" onClick={() => void revoke(i.id)}>
                          Revogar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pager">
            <span className="muted">
              {list.total} convite(s) · página {list.page} de {pages}
            </span>
            <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <button className="btn ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
