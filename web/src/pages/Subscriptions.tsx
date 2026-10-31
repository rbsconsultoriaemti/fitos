import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listSubscriptions, ROLE_LABELS, type Page, type SubscriptionRow } from '../api';
import ErrorNotice from '../ErrorNotice';

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativa',
  trialing: 'Em teste',
  past_due: 'Cobrança pendente',
  canceled: 'Cancelada',
  expired: 'Expirada',
};

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const quotaText = (q: { used: number; limit: number }) => `${q.used} de ${q.limit}`;

/** Assinaturas e cotas (somente leitura: a assinatura muda só pelo RevenueCat). */
export default function Subscriptions() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [text, setText] = useState(q);
  const [data, setData] = useState<Page<SubscriptionRow> | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    listSubscriptions(q, page)
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
      <h1>Assinaturas e cotas</h1>
      <p className="muted">Somente leitura. Assinaturas vêm do RevenueCat. As cotas mostram o uso atual de cada conta.</p>
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
            <p className="empty muted">Nenhuma conta encontrada.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Plano</th>
                  <th>Situação</th>
                  <th>Vence em</th>
                  <th>Fotos (cota)</th>
                  <th>Planos por IA (cota)</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      <br />
                      <span className="muted">
                        {r.email} · {ROLE_LABELS[r.role]}
                        {r.isActive ? '' : ' · inativa'}
                      </span>
                    </td>
                    <td>
                      {r.effectivePlan === 'paid' ? 'Pago' : 'Gratuito'}
                      {r.subscription ? (
                        <>
                          <br />
                          <span className="muted">
                            {r.subscription.store ?? '—'} · {r.subscription.environment === 'PRODUCTION' ? 'produção' : 'teste'}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {r.subscription ? (STATUS_LABELS[r.subscription.status] ?? r.subscription.status) : <span className="muted">Sem assinatura</span>}
                      {r.subscription && r.subscription.autoRenew === false ? <span className="muted"> · sem renovação</span> : null}
                    </td>
                    <td>{dateText(r.subscription?.expiresAt ?? null)}</td>
                    <td>
                      {quotaText(r.quotas.photoRecognition)}
                      <br />
                      <span className="muted">{r.quotas.photoRecognition.plan === 'paid' ? 'por dia' : 'nos 30 dias'}</span>
                    </td>
                    <td>
                      {quotaText(r.quotas.workoutPlan)}
                      <br />
                      <span className="muted">
                        {r.quotas.workoutPlan.resetsAt ? `libera em ${dateText(r.quotas.workoutPlan.resetsAt)}` : 'disponível'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pager">
            <span className="muted">
              {data.total} conta(s) · página {data.page} de {pages}
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
