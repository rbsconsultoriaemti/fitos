import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { ROLE_LABELS } from './api';
import { AuthProvider, useAuth } from './auth';
import Login from './pages/Login';
import Users from './pages/Users';

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

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">FitOS</span>
          <nav className="nav" aria-label="Principal">
            <NavLink to="/usuarios">Usuários</NavLink>
          </nav>
          <div className="who">
            <span>
              {state.user.name} <span className="muted">· {ROLE_LABELS[state.user.role]}</span>
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
          <Route element={<RequireAuth />}>
            <Route path="/usuarios" element={<Users />} />
          </Route>
          <Route path="*" element={<Navigate to="/usuarios" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
