import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { SessionProvider, useSession } from '@/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator() {
  const { user, isLoading } = useSession();

  // Mantém a splash até saber se há sessão salva (evita piscar a tela de login).
  if (!isLoading) SplashScreen.hide();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
