import type { ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { T } from '@/components/ui';
import { space, useColors } from '@/theme';

/** Moldura das telas de login/cadastro: marca no topo e formulário rolável acima do teclado. */
export function AuthScreen({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: space.xl,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xl,
          gap: space.xl,
          maxWidth: 480,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View style={{ gap: space.sm }}>
          <Image source={require('../../assets/images/splash-icon.png')} style={{ width: 96, height: 96, alignSelf: 'center' }} resizeMode="contain" accessibilityLabel="Logo FitOS" />
          <T variant="h2">{title}</T>
          <T variant="muted">{subtitle}</T>
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
