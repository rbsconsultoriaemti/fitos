import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { useSession } from '@/session';
import { useColors } from '@/theme';

export default function TabsLayout() {
  const c = useColors();
  const { signOut } = useSession();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.card },
        headerTintColor: c.text,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color as string} size={size} />,
          headerRight: () => (
            <Pressable onPress={signOut} hitSlop={8} style={{ paddingHorizontal: 16 }}>
              <Text style={{ color: c.primary, fontWeight: '700' }}>Sair</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{ title: 'Treino', tabBarIcon: ({ color, size }) => <Ionicons name="barbell" color={color as string} size={size} /> }}
      />
    </Tabs>
  );
}
