import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchPortalUser, login as apiLogin, logout as apiLogout, refreshSession, type PortalUser } from './api';

type State = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: PortalUser };

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
        if (alive) setState({ status: 'in', user });
      } catch {
        if (alive) setState({ status: 'out' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await apiLogin(email, password); // qualquer conta ativa entra; a permissão é decidida pelo backend, rota por rota
    const user = await fetchPortalUser();
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
