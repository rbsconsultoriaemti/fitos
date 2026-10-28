import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { acceptInvite, BRAZIL_STATES, COUNCILS_BY_ROLE, COUNCIL_LABELS, describeError, describeInvite, ROLE_LABELS, type AcceptInviteBody, type Council, type InvitePreview, type Role, type ValidationStatus } from '../api';

interface Done {
  role: Role;
  validationStatus: ValidationStatus;
}

/** Aceite de convite (público, sem sessão). O backend define o papel pelo convite; aqui só se coleta o cadastro. */
export default function Accept() {
  const { token = '' } = useParams();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', council: '' as Council | '', number: '', uf: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    let alive = true;
    describeInvite(token)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setLoadError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [token]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const councils = preview ? (COUNCILS_BY_ROLE[preview.role] ?? []) : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    setFormError(null);
    const body: AcceptInviteBody = { name: form.name.trim(), email: form.email.trim(), password: form.password };
    if (preview.requiresRegistration) {
      body.registrationCouncil = form.council || undefined;
      body.registrationNumber = form.number.trim() || undefined;
      body.registrationState = form.uf || undefined;
    }
    try {
      const r = await acceptInvite(token, body);
      setDone({ role: r.user.role, validationStatus: r.user.validationStatus });
    } catch (err) {
      setFormError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <main className="center">
        <div className="login">
          <h1>Convite indisponível</h1>
          <div className="card">
            <p className="error">{loadError}</p>
            <p className="muted">Peça um novo convite a quem te convidou.</p>
          </div>
        </div>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="center">
        <p className="muted">Carregando convite…</p>
      </main>
    );
  }

  if (done) {
    const pending = done.validationStatus === 'pending';
    return (
      <main className="center">
        <div className="login">
          <h1>{pending ? 'Cadastro recebido' : 'Conta criada'}</h1>
          <div className="card">
            {pending ? (
              <p>
                Seu registro de {ROLE_LABELS[done.role]} fica em análise até o administrador validar. Você já pode entrar no portal e acompanhar o status.
              </p>
            ) : (
              <p>Sua conta está pronta. Entre no aplicativo FitOS com este e-mail e senha.</p>
            )}
          </div>
          {pending ? (
            <Link to="/login" className="btn">
              Entrar no portal
            </Link>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="center">
      <div className="login">
        <div>
          <h1>Você foi convidado</h1>
          <p className="muted">
            {preview.invitedBy} convidou você como <strong>{ROLE_LABELS[preview.role]}</strong>.
          </p>
        </div>
        <form className="card" style={{ display: 'grid', gap: 16 }} onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Nome</label>
            <input id="name" value={form.name} onChange={set('name')} required minLength={2} maxLength={120} autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" type="email" value={form.email} onChange={set('email')} required maxLength={254} autoComplete="email" />
            {preview.requiresEmail ? <span className="muted">Use o e-mail para o qual o convite foi enviado.</span> : null}
          </div>
          <div className="field">
            <label htmlFor="password">Senha (mínimo 8 caracteres)</label>
            <input id="password" type="password" value={form.password} onChange={set('password')} required minLength={8} maxLength={72} autoComplete="new-password" />
          </div>
          {preview.requiresRegistration ? (
            <>
              <div className="field">
                <label htmlFor="council">Conselho</label>
                <select id="council" value={form.council} onChange={set('council')} required>
                  <option value="">Selecione</option>
                  {councils.map((c) => (
                    <option key={c} value={c}>
                      {COUNCIL_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="uf">Estado (UF) do registro</label>
                <select id="uf" value={form.uf} onChange={set('uf')} required>
                  <option value="">Selecione</option>
                  {BRAZIL_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
                <span className="muted">Estado onde o conselho emitiu o seu registro.</span>
              </div>
              <div className="field">
                <label htmlFor="number">Número de registro</label>
                <input id="number" value={form.number} onChange={set('number')} required maxLength={30} />
                <span className="muted">Seu cadastro só fica ativo depois que o administrador validar este número.</span>
              </div>
            </>
          ) : null}
          {formError ? <p className="error">{formError}</p> : null}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Criando conta…' : 'Criar conta'}
          </button>
        </form>
      </div>
    </main>
  );
}
