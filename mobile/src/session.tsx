import { createContext, use, useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { api, getRefreshToken, loadTokens, saveTokens, setSessionLostHandler } from '@/lib/api';
import { clearOfflineData, getCachedUser, isOffline, setCachedUser } from '@/lib/offline';
import type { AuthResponse, User } from '@/lib/types';

interface SessionValue {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession() {
  const value = use(SessionContext);
  if (!value) throw new Error('useSession deve ser usado dentro de <SessionProvider />');
  return value;
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    setSessionLostHandler(() => setUser(null));
    (async () => {
      try {
        if (await loadTokens()) {
          const me = await api<User>('/auth/me');
          setUser(me);
          await setCachedUser(me);
        }
      } catch (err) {
        if (isOffline(err)) {
          // Sem rede no início: entra com o usuário salvo e mantém os tokens; a sincronização acontece depois.
          const cached = await getCachedUser();
          if (cached) setUser(cached);
        } else {
          await saveTokens(null);
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => setSessionLostHandler(null);
  }, []);

  const authenticate = useCallback(async (path: '/auth/login' | '/auth/register', body: object) => {
    const res = await api<AuthResponse>(path, { method: 'POST', body, auth: false });
    await saveTokens(res);
    await setCachedUser(res.user);
    setUser(res.user);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      isLoading,
      signIn: (email, password) => authenticate('/auth/login', { email, password }),
      // O app é do aluno; cadastro de profissionais fica para o app/painel deles.
      signUp: (name, email, password) => authenticate('/auth/register', { name, email, password, role: 'student' }),
      signOut: async () => {
        const token = getRefreshToken();
        if (token) await api('/auth/logout', { method: 'POST', body: { refreshToken: token }, auth: false }).catch(() => {});
        await saveTokens(null);
        await clearOfflineData();
        setUser(null);
      },
    }),
    [user, isLoading, authenticate],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
