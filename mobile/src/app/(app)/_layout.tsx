import { Stack } from 'expo-router';

import { useColors } from '@/theme';

export default function AppLayout() {
  const c = useColors();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.card }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="food/search" options={{ title: 'Adicionar alimento', presentation: 'modal' }} />
      <Stack.Screen name="food/entry" options={{ title: 'Alimento', presentation: 'modal' }} />
    </Stack>
  );
}
