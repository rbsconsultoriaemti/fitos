import { Stack } from 'expo-router';

import { useColors } from '@/theme';

export default function AppLayout() {
  const c = useColors();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.card }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="edit-plan" options={{ title: 'Editar plano' }} />
      <Stack.Screen name="food/search" options={{ title: 'Adicionar alimento' }} />
      <Stack.Screen name="food/quantity" options={{ title: 'Quantidade' }} />
      <Stack.Screen name="food/photo" options={{ title: 'Foto → calorias' }} />
      <Stack.Screen name="log/[id]" options={{ title: 'Treino realizado' }} />
    </Stack>
  );
}
