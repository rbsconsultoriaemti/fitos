import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { T } from '@/components/ui';
import { space, useColors } from '@/theme';

/** Cabeçalho das abas no estilo iOS: título grande (34 bold) à esquerda, ação opcional à direita, fundo igual ao da tela. */
export function TabHeader({ title, right }: { title?: string; right?: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: c.bg,
        paddingTop: insets.top + space.sm,
        paddingHorizontal: space.lg,
        paddingBottom: title ? space.xs : 0,
        minHeight: title ? undefined : insets.top + 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.md,
      }}
    >
      {title ? (
        <T variant="title" numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </T>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {right}
    </View>
  );
}
