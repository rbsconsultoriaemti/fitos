import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { canInvite, ROLE_LABELS } from './api';
import { AuthProvider, useAuth } from './auth';
import Accept from './pages/Accept';
import Home from './pages/Home';
import Invites from './pages/Invites';
import Login from './pages/Login';
import UserDetail from './pages/UserDetail';
import Users from './pages/Users';
import Validation from './pages/Validation';

/** Guarda de rota: sem sessão confirmada pelo backend, volta para o login. */
function RequireAuth() {
  const { state, logout } = useAuth();
  if (state.status === 'loading') {
    return (
      <main className="center">
        <p className="muted">Carregando…</p>
      </main>
    );
  }
  if (state.status === 'out') return <Navigate to="/login" replace />;

  const { user } = state;
  // O menu só mostra atalhos; cada tela continua protegida pelo backend.
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">FitOS</span>
          <nav className="nav" aria-label="Principal">
            <NavLink to="/" end>
              Início
            </NavLink>
            {user.isPlatformAdmin ? (
              <>
                <NavLink to="/usuarios">Usuários</NavLink>
                <NavLink to="/validacao">Validação</NavLink>
              </>
            ) : null}
            {canInvite(user) ? <NavLink to="/convites">Convites</NavLink> : null}
          </nav>
          <div className="who">
            <span>
              {user.name} <span className="muted">· {ROLE_LABELS[user.role]}</span>
            </span>
            <button className="btn ghost" onClick={() => void logout()}>
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Público: o link do convite leva o token no caminho. Não exige sessão. */}
          <Route path="/convite/:token" element={<Accept />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Home />} />
            <Route path="/usuarios" element={<Users />} />
            <Route path="/usuarios/:id" element={<UserDetail />} />
            <Route path="/validacao" element={<Validation />} />
            <Route path="/convites" element={<Invites />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
