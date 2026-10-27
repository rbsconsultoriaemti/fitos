import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { Pressable } from 'react-native';

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
    if (!user || user.role !== 'student') return;
    void askPermissionOnFirstOpen().then(() => rescheduleAll({ refresh: true }));
    return rescheduleOnForeground();
  }, [user]);

  return (
    <Stack
      screenOptions={{
        // Barra de navegação estilo iOS: título centralizado semibold 17, chevron de voltar, mesmo fundo da tela.
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.primary,
        headerTitleAlign: 'center',
        headerTitleStyle: { color: c.text, fontSize: 17, fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
        headerLeft: ({ canGoBack }) =>
          canGoBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={12} onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginLeft: -4 })}>
              <Ionicons name="chevron-back" size={28} color={c.primary} />
            </Pressable>
          ) : null,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="edit-plan" options={{ title: 'Editar plano' }} />
      <Stack.Screen name="food/search" options={{ title: 'Adicionar alimento' }} />
      <Stack.Screen name="food/barcode" options={{ title: 'Código de barras' }} />
      <Stack.Screen name="food/quantity" options={{ title: 'Quantidade' }} />
      <Stack.Screen name="food/photo" options={{ title: 'Foto → calorias' }} />
      <Stack.Screen name="settings/notifications" options={{ title: 'Notificações' }} />
      <Stack.Screen name="trainer/student/[id]" options={{ title: 'Aluno' }} />
      <Stack.Screen name="trainer/prescribe/[studentId]" options={{ title: 'Prescrever treino' }} />
      <Stack.Screen name="log/[id]" options={{ title: 'Treino realizado' }} />
    </Stack>
  );
}
