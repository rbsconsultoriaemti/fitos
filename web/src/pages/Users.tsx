import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listAdminUsers, ROLE_LABELS, type AdminUser, type Page } from '../api';
import ErrorNotice from '../ErrorNotice';

/** Usuários e papéis: busca, tabela e paginação. A autorização é do backend (403/401 aparecem no ErrorNotice). */
export default function Users() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [text, setText] = useState(q);
  const [data, setData] = useState<Page<AdminUser> | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    listAdminUsers(q, page)
      .then((d) => alive && setData(d))
      .catch((e) => alive && (setData(null), setError(e)));
    return () => {
      alive = false;
    };
  }, [q, page]);

  const go = (nextQ: string, nextPage: number) => setParams({ ...(nextQ ? { q: nextQ } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(text.trim(), 1);
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <h1>Usuários e papéis</h1>
      <form className="searchbar" onSubmit={submit} role="search">
        <input type="search" aria-label="Buscar por nome ou e-mail" placeholder="Buscar por nome ou e-mail" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" type="submit">
          Buscar
        </button>
      </form>
      {error ? <ErrorNotice error={error} /> : null}
      {!error && !data ? <p className="muted">Carregando…</p> : null}
      {data ? (
        <div className="card tablecard">
          {data.items.length === 0 ? (
            <p className="empty muted">Nenhum usuário encontrado.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>Ativo</th>
                  <th>Administrador da plataforma</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link to={`/usuarios/${u.id}`}>{u.name}</Link>
                    </td>
                    <td>{u.email}</td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td>{u.isActive ? 'Sim' : <span className="error">Não</span>}</td>
                    <td>{u.isPlatformAdmin ? 'Sim' : 'Não'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pager">
            <span className="muted">
              {data.total} usuário(s) · página {data.page} de {pages}
            </span>
            <button className="btn ghost" disabled={page <= 1} onClick={() => go(q, page - 1)}>
              Anterior
            </button>
            <button className="btn ghost" disabled={page >= pages} onClick={() => go(q, page + 1)}>
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
