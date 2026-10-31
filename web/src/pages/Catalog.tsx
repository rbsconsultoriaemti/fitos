import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  listCatalogFoods,
  listFoodAudit,
  patchCatalogFood,
  type CatalogFood,
  type FoodAuditEntry,
  type Page,
  type Portion,
} from '../api';
import ErrorNotice from '../ErrorNotice';

const SOURCE_LABELS: Record<CatalogFood['source'], string> = { taco: 'TACO', custom: 'Próprio', openfoodfacts: 'Open Food Facts' };

interface PortionRow {
  key: number;
  label: string;
  grams: string;
}

let rowSeq = 0;
const toRows = (ps: Portion[]): PortionRow[] => ps.map((p) => ({ key: ++rowSeq, label: p.label, grams: String(p.grams) }));

/** Catálogo de alimentos: busca, filtros, sem glúten, ocultar, porções e histórico. Cada alteração vai para a trilha. */
export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const situation = params.get('situacao') ?? 'todos'; // todos | ocultos | visiveis
  const gluten = params.get('gluten') === 'sim'; // só os marcados como sem glúten
  const [text, setText] = useState(q);
  const [data, setData] = useState<Page<CatalogFood> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [selected, setSelected] = useState<CatalogFood | null>(null);
  const [rows, setRows] = useState<PortionRow[]>([]);
  const [audit, setAudit] = useState<FoodAuditEntry[] | null>(null);
  const [panelError, setPanelError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    listCatalogFoods({
      q: q || undefined,
      page,
      hidden: situation === 'ocultos' ? true : situation === 'visiveis' ? false : undefined,
      glutenFree: gluten ? true : undefined,
    })
      .then((d) => alive && setData(d))
      .catch((e) => alive && (setData(null), setError(e)));
    return () => {
      alive = false;
    };
  }, [q, page, situation, gluten]);

  const go = (next: { q?: string; page?: number; situacao?: string; gluten?: boolean }) => {
    const nq = next.q ?? q;
    const np = next.page ?? 1;
    const ns = next.situacao ?? situation;
    const ng = next.gluten ?? gluten;
    setParams({
      ...(nq ? { q: nq } : {}),
      ...(np > 1 ? { page: String(np) } : {}),
      ...(ns !== 'todos' ? { situacao: ns } : {}),
      ...(ng ? { gluten: 'sim' } : {}),
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    go({ q: text.trim() });
  };

  /** Liga/desliga um campo simples (sem glúten, oculto) e atualiza a linha com a resposta do backend. */
  async function toggle(food: CatalogFood, field: 'glutenFree' | 'hidden') {
    setBusy(`${food.id}:${field}`);
    setError(null);
    try {
      const updated = await patchCatalogFood(food.id, { [field]: !food[field] });
      setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === updated.id ? updated : i)) } : d));
      if (selected?.id === updated.id) setSelected(updated);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function openPanel(food: CatalogFood) {
    setSelected(food);
    setRows(toRows(food.portions));
    setAudit(null);
    setPanelError(null);
    try {
      setAudit((await listFoodAudit(food.id)).items);
    } catch (e) {
      setPanelError(e);
    }
  }

  async function savePortions() {
    if (!selected) return;
    setPanelError(null);
    const portions: Portion[] = [];
    for (const r of rows) {
      const label = r.label.trim();
      const grams = Number(r.grams.replace(',', '.'));
      if (!label || !Number.isFinite(grams) || grams <= 0 || grams > 5000) {
        setPanelError(new Error('Cada porção precisa de um nome e de gramas entre 0 e 5000.'));
        return;
      }
      portions.push({ label, grams });
    }
    setSaving(true);
    try {
      const updated = await patchCatalogFood(selected.id, { portions });
      setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === updated.id ? updated : i)) } : d));
      setSelected(updated);
      setRows(toRows(updated.portions));
      setAudit((await listFoodAudit(updated.id)).items);
    } catch (e) {
      setPanelError(e);
    } finally {
      setSaving(false);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <h1>Catálogo de alimentos</h1>
      <p className="muted">Ocultar tira o alimento da busca dos alunos. O histórico continua funcionando. Cada alteração fica registrada.</p>

      <form className="searchbar" onSubmit={submit} role="search">
        <input type="search" aria-label="Buscar alimento" placeholder="Buscar alimento" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" type="submit">
          Buscar
        </button>
      </form>
      <div className="inline" role="group" aria-label="Filtros">
        {[
          ['todos', 'Todos'],
          ['visiveis', 'Visíveis'],
          ['ocultos', 'Ocultos'],
        ].map(([value, label]) => (
          <button key={value} className={situation === value ? 'btn' : 'btn ghost'} aria-pressed={situation === value} onClick={() => go({ situacao: value, page: 1 })}>
            {label}
          </button>
        ))}
        <button className={gluten ? 'btn' : 'btn ghost'} aria-pressed={gluten} onClick={() => go({ gluten: !gluten, page: 1 })}>
          Só sem glúten
        </button>
      </div>

      <ErrorNotice error={error} />
      {!error && !data ? <p className="muted">Carregando…</p> : null}

      {selected ? (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <h2>Porções de {selected.displayName}</h2>
          <p className="muted">
            Origem: {SOURCE_LABELS[selected.source]} · {Math.round(selected.kcalPer100g)} kcal por 100 g
          </p>
          <ErrorNotice error={panelError} />
          {rows.length === 0 ? <p className="muted">Sem porções caseiras: o aluno registra só em gramas.</p> : null}
          {rows.map((r) => (
            <div key={r.key} className="inline">
              <input aria-label="Nome da porção" value={r.label} maxLength={40} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, label: e.target.value } : x)))} />
              <input aria-label="Gramas" inputMode="decimal" value={r.grams} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, grams: e.target.value } : x)))} style={{ width: 100 }} />
              <span className="muted">g</span>
              <button className="btn ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                Remover
              </button>
            </div>
          ))}
          <div className="actions">
            <button className="btn ghost" disabled={rows.length >= 12} onClick={() => setRows((rs) => [...rs, { key: ++rowSeq, label: '', grams: '' }])}>
              Adicionar porção
            </button>
            <button className="btn ghost" onClick={() => setSelected(null)}>
              Fechar
            </button>
            <button className="btn" disabled={saving} onClick={savePortions}>
              {saving ? 'Salvando…' : 'Salvar porções'}
            </button>
          </div>
          <h2>Histórico</h2>
          {audit === null ? <p className="muted">Carregando…</p> : null}
          {audit && audit.length === 0 ? <p className="muted">Nenhuma alteração registrada.</p> : null}
          {audit && audit.length > 0 ? (
            <ul className="history">
              {audit.map((a) => (
                <li key={a.id}>
                  <span>{new Date(a.createdAt).toLocaleString('pt-BR')} · {a.actorName ?? 'Conta removida'}</span>
                  <span className="muted">{describeChange(a)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {data ? (
        <div className="card tablecard">
          {data.items.length === 0 ? (
            <p className="empty muted">Nenhum alimento encontrado.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Alimento</th>
                  <th>Origem</th>
                  <th>Sem glúten</th>
                  <th>Oculto</th>
                  <th>Porções</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.displayName}
                      {f.category ? <span className="muted"> · {f.category}</span> : null}
                    </td>
                    <td>{SOURCE_LABELS[f.source]}</td>
                    <td>
                      <button className={f.glutenFree ? 'btn' : 'btn ghost'} aria-pressed={f.glutenFree} disabled={busy === `${f.id}:glutenFree`} onClick={() => toggle(f, 'glutenFree')}>
                        {f.glutenFree ? 'Sim' : 'Não'}
                      </button>
                    </td>
                    <td>
                      <button className={f.hidden ? 'btn danger-text' : 'btn ghost'} aria-pressed={f.hidden} disabled={busy === `${f.id}:hidden`} onClick={() => toggle(f, 'hidden')}>
                        {f.hidden ? 'Oculto' : 'Visível'}
                      </button>
                    </td>
                    <td>
                      {f.portions.length} <button className="btn ghost" onClick={() => openPanel(f)}>Editar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pager">
            <span className="muted">
              {data.total} alimento(s) · página {data.page} de {pages}
            </span>
            <button className="btn ghost" disabled={page <= 1} onClick={() => go({ page: page - 1 })}>
              Anterior
            </button>
            <button className="btn ghost" disabled={page >= pages} onClick={() => go({ page: page + 1 })}>
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Texto curto do que mudou numa alteração (campos conhecidos; o resto aparece como "alterado"). */
function describeChange(a: FoodAuditEntry): string {
  const parts: string[] = [];
  if ('glutenFree' in a.after) parts.push(a.after.glutenFree ? 'marcado como sem glúten' : 'desmarcado como sem glúten');
  if ('hidden' in a.after) parts.push(a.after.hidden ? 'ocultado' : 'reexibido');
  if ('portions' in a.after) parts.push('porções alteradas');
  return parts.length ? parts.join(' · ') : 'alterado';
}
