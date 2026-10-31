import { Link } from 'react-router-dom';
import { canInvite, PROFESSIONAL_ROLES, ROLE_LABELS } from '../api';
import { useAuth } from '../auth';

/** Tela inicial: mostra o que a conta (conferida em GET /portal/me) pode ver. Só informa; o backend decide cada rota. */
export default function Home() {
  const { state } = useAuth();
  if (state.status !== 'in') return null;
  const { user } = state;
  const isProfessional = PROFESSIONAL_ROLES.includes(user.role);

  if (!user.isPlatformAdmin && !isProfessional) {
    return (
      <>
        <h1>Olá, {user.name}</h1>
        <div className="card empty">
          <p>A área de administração e de profissionais fica aqui. Seus treinos e sua dieta estão no aplicativo.</p>
        </div>
      </>
    );
  }

  const pendingPro = isProfessional && !user.isPlatformAdmin && user.validationStatus === 'pending';
  const rejectedPro = isProfessional && !user.isPlatformAdmin && user.validationStatus === 'rejected';

  return (
    <>
      <h1>Olá, {user.name}</h1>
      <p className="muted">{user.isPlatformAdmin ? 'Administrador da plataforma' : ROLE_LABELS[user.role]}</p>

      {pendingPro ? (
        <div className="card">
          <h2>Registro em análise</h2>
          <p className="muted">
            Seu cadastro de {ROLE_LABELS[user.role]} aguarda validação do administrador. Enquanto isso, convites e as ferramentas de profissional ficam bloqueados.
          </p>
        </div>
      ) : null}

      {rejectedPro ? (
        <div className="card">
          <h2>Registro não aprovado</h2>
          <p className="muted">O administrador não aprovou seu cadastro. Entre em contato com a administração da plataforma.</p>
        </div>
      ) : null}

      {user.isPlatformAdmin ? (
        <div className="card">
          <h2>Administração</h2>
          <p>
            <Link to="/usuarios">Usuários e papéis</Link> · <Link to="/validacao">Validação de profissionais</Link> · <Link to="/convites">Convites</Link> · <Link to="/assinaturas">Assinaturas e cotas</Link> · <Link to="/catalogo">Catálogo</Link> · <Link to="/metricas">Métricas</Link>
          </p>
        </div>
      ) : null}

      {isProfessional && !user.isPlatformAdmin && canInvite(user) ? (
        <div className="card">
          <h2>Profissional</h2>
          <p>
            <Link to="/convites">Convites</Link>
          </p>
          <p className="muted">As telas de acompanhamento de alunos chegam nas próximas etapas.</p>
        </div>
      ) : null}
    </>
  );
}
