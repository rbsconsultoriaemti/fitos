import { Link } from 'react-router-dom';
import { PROFESSIONAL_ROLES, ROLE_LABELS } from '../api';
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

  return (
    <>
      <h1>Olá, {user.name}</h1>
      <p className="muted">{user.isPlatformAdmin ? 'Administrador da plataforma' : ROLE_LABELS[user.role]}</p>
      {user.isPlatformAdmin ? (
        <div className="card">
          <h2>Administração</h2>
          <p>
            <Link to="/usuarios">Usuários e papéis</Link>
          </p>
        </div>
      ) : null}
      {isProfessional ? (
        <div className="card">
          <h2>Profissional</h2>
          <p className="muted">{ROLE_LABELS[user.role]}. As telas de acompanhamento de alunos chegam nas próximas etapas.</p>
        </div>
      ) : null}
    </>
  );
}
