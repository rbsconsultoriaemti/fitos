import { router, Stack } from 'expo-router';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { askPermissionOnFirstOpen, rescheduleAll, rescheduleOnForeground } from '@/lib/notifications';
import { isOnboardingPostponed } from '@/lib/onboarding';
import type { Profile } from '@/lib/types';
import { useSession } from '@/session';
import { useColors } from '@/theme';

export default function AppLayout() {
  const c = useColors();
  const { user } = useSession();

  // Perfil incompleto (ou questionário em andamento): abre o onboarding logo após o login.
  useEffect(() => {
    if (!user || user.role !== 'student' || isOnboardingPostponed()) return;
    api<Profile>('/profile')
      .then((p) => {
        if (p.onboardingNeeded) router.replace('/onboarding' as never);
      })
      .catch(() => undefined); // sem rede: não interrompe quem só quer treinar
  }, [user]);

  // Lembretes: pede permissão na primeira abertura e reagenda tudo a cada abertura do app (e ao voltar para ele).
  useEffect(() => {
    if (!user) return;
    void askPermissionOnFirstOpen().then(() => rescheduleAll({ refresh: true }));
    return rescheduleOnForeground();
  }, [user]);

  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.card }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="edit-plan" options={{ title: 'Editar plano' }} />
      <Stack.Screen name="food/search" options={{ title: 'Adicionar alimento' }} />
      <Stack.Screen name="food/barcode" options={{ title: 'Código de barras' }} />
      <Stack.Screen name="food/quantity" options={{ title: 'Quantidade' }} />
      <Stack.Screen name="food/photo" options={{ title: 'Foto → calorias' }} />
      <Stack.Screen name="settings/notifications" options={{ title: 'Notificações' }} />
      <Stack.Screen name="log/[id]" options={{ title: 'Treino realizado' }} />
    </Stack>
  );
}
