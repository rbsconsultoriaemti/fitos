import { useEffect, useState } from 'react';
import { COUNCIL_LABELS, decideProfessional, listPendingProfessionals, ROLE_LABELS, type Page, type PendingProfessional } from '../api';
import ErrorNotice from '../ErrorNotice';

/** Fila de validação de profissionais (somente administrador). Rejeição é final pela API. */
export default function Validation() {
  const [page, setPage] = useState(1);
  const [list, setList] = useState<Page<PendingProfessional> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    listPendingProfessionals(page)
      .then((d) => alive && setList(d))
      .catch((e) => alive && (setList(null), setError(e)));
    return () => {
      alive = false;
    };
  }, [page, version]);

  const decide = async (p: PendingProfessional, decision: 'validate' | 'reject') => {
    if (decision === 'reject' && !window.confirm(`Rejeitar o registro de ${p.name}? A rejeição é definitiva.`)) return;
    setBusyId(p.id);
    setNotice(null);
    try {
      await decideProfessional(p.id, decision);
      setNotice(decision === 'validate' ? `${p.name} foi validado.` : `${p.name} foi rejeitado.`);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <>
      <h1>Validação de profissionais</h1>
      <p className="muted">Confira o número de registro no site do conselho antes de validar.</p>
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      {error ? <ErrorNotice error={error} /> : null}
      {!error && !list ? <p className="muted">Carregando…</p> : null}
      {list ? (
        <div className="card tablecard">
          {list.items.length === 0 ? (
            <p className="empty muted">Nenhum cadastro aguardando validação.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>Registro</th>
                  <th>Enviado em</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.email}</td>
                    <td>{ROLE_LABELS[p.role]}</td>
                    <td>
                      {p.registrationCouncil ? COUNCIL_LABELS[p.registrationCouncil] : '—'}
                      {p.registrationState ? ` · ${p.registrationState}` : ''}
                      {p.registrationNumber ? ` · ${p.registrationNumber}` : ''}
                    </td>
                    <td>{new Date(p.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td className="actions">
                      <button className="btn" type="button" disabled={busyId === p.id} onClick={() => void decide(p, 'validate')}>
                        Validar
                      </button>
                      <button className="btn ghost danger-text" type="button" disabled={busyId === p.id} onClick={() => void decide(p, 'reject')}>
                        Rejeitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pager">
            <span className="muted">
              {list.total} aguardando · página {list.page} de {pages}
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
