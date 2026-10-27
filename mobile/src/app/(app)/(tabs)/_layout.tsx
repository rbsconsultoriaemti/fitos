import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useSession } from '@/session';
import { useColors } from '@/theme';

export default function TabsLayout() {
  const c = useColors();
  const { signOut, user } = useSession();
  const isTrainer = user?.role === 'trainer';
  const hide = isTrainer ? { href: null } : {};

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
        // Barra de navegação estilo iOS: título centralizado semibold 17, fundo igual ao da tela, divisor fino.
        headerStyle: { backgroundColor: c.bg, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth, elevation: 0, shadowOpacity: 0 },
        headerTitleAlign: 'center',
        headerTitleStyle: { color: c.text, fontSize: 17, fontWeight: '600' },
        headerTintColor: c.text,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} color={color as string} size={size} />,
          headerRight: () => (
            <Pressable onPress={signOut} hitSlop={8} style={{ paddingHorizontal: 16 }}>
              <Text style={{ color: c.primary, fontSize: 17 }}>Sair</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{ ...hide, title: 'Treino', tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'barbell' : 'barbell-outline'} color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="nutrition"
        options={{ ...hide, title: 'Nutrição', tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'nutrition' : 'nutrition-outline'} color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="progress"
        options={{ ...hide, title: 'Progresso', tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="prescribe"
        options={{ ...(isTrainer ? {} : { href: null }), title: 'Prescrever', tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'create' : 'create-outline'} color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Perfil', tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'person' : 'person-outline'} color={color as string} size={size} /> }}
      />
    </Tabs>
  );
}
