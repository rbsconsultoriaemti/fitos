import { useEffect, useState } from 'react';
import { getMetrics, type Metrics } from '../api';
import ErrorNotice from '../ErrorNotice';

const PERIODS = [7, 30, 90] as const;
const fmt = (n: number) => n.toLocaleString('pt-BR');
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Métricas de uso (somente leitura). Contagens do banco; o custo de IA é estimativa. */
export default function Metrics() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    getMetrics(days)
      .then((d) => alive && setData(d))
      .catch((e) => alive && (setData(null), setError(e)));
    return () => {
      alive = false;
    };
  }, [days]);

  const card = (label: string, value: string, hint?: string) => (
    <div className="card" key={label}>
      <p className="muted">{label}</p>
      <h2>{value}</h2>
      {hint ? <p className="muted">{hint}</p> : null}
    </div>
  );

  return (
    <>
      <h1>Métricas de uso</h1>
      <div className="inline" role="group" aria-label="Período">
        {PERIODS.map((d) => (
          <button key={d} className={d === days ? 'btn' : 'btn ghost'} onClick={() => setDays(d)} aria-pressed={d === days}>
            Últimos {d} dias
          </button>
        ))}
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      {!error && !data ? <p className="muted">Carregando…</p> : null}
      {data ? (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {card('Contas', fmt(data.users.total), `${fmt(data.users.active)} ativas`)}
            {card('Alunos', fmt(data.users.students))}
            {card('Profissionais', fmt(data.users.professionals), `${fmt(data.users.pendingProfessionals)} aguardando validação`)}
            {card('Novas contas no período', fmt(data.users.newInWindow))}
            {card('Ativos no período', fmt(data.activity.activeInWindow), 'com sessão aberta ou renovada')}
            {card('Ativos nos últimos 7 dias', fmt(data.activity.activeLast7Days))}
            {card('Fotos reconhecidas', fmt(data.usage.photoRecognitions), 'chamadas de IA bem-sucedidas')}
            {card('Planos de treino por IA', fmt(data.usage.workoutPlansByAi))}
            {card('Assinaturas premium ativas', fmt(data.subscriptions.premiumActive), `${fmt(data.subscriptions.trialing)} em teste · ${fmt(data.subscriptions.pastDue)} com cobrança pendente`)}
            {card('Custo de IA estimado', brl(data.aiCost.estimatedBrl), `${brl(data.aiCost.costPerCallBrl)} por chamada (estimativa)`)}
          </div>
          <p className="muted">
            {data.aiCost.note} Gerado em {new Date(data.generatedAt).toLocaleString('pt-BR')}.
          </p>
        </>
      ) : null}
    </>
  );
}
