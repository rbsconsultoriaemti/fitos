import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, PORTAL_ROLES, fetchPortalUser, login as apiLogin, logout as apiLogout, refreshSession, type User } from './api';

type State = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: User };

interface AuthValue {
  state: State;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  // Ao abrir (ou recarregar) a página não há token em memória: tenta renovar pelo cookie e confirma no backend.
  useEffect(() => {
    let alive = true;
    (async () => {
      const session = await refreshSession();
      if (!session) return alive && setState({ status: 'out' });
      try {
        const user = await fetchPortalUser();
        if (alive) setState(PORTAL_ROLES.includes(user.role) ? { status: 'in', user } : { status: 'out' });
      } catch {
        if (alive) setState({ status: 'out' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await apiLogin(email, password); // 403 => aluno ou conta sem acesso (a mensagem vem do backend)
    const user = await fetchPortalUser();
    if (!PORTAL_ROLES.includes(user.role)) throw new ApiError(403, 'portal_forbidden', 'Esta conta não tem acesso ao portal');
    setState({ status: 'in', user });
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setState({ status: 'out' });
  }, []);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
