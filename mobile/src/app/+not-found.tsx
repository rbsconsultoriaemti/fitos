import { Redirect } from 'expo-router';

import { useSession } from '@/session';

// Rota protegida some quando a guarda falha (ex.: "/" sem login): em vez de "Unmatched Route",
// manda para o lugar certo conforme a sessão.
export default function NotFound() {
  const { user } = useSession();
  return <Redirect href={user ? '/' : '/login'} />;
}
