import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Empty, ErrorText, T } from '@/components/ui';
import { errorMessage } from '@/lib/dialog';
import { fmt0, foodLabel, MEAL_LABELS } from '@/lib/format';
import { loadTemplates } from '@/lib/offline';
import type { MealTemplate } from '@/lib/types';
import { space } from '@/theme';

/** Perfil > Refeições favoritas: lista para abrir e editar. */
export default function FavoriteMeals() {
  const insets = useSafeAreaInsets();
  const [templates, setTemplates] = useState<MealTemplate[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadTemplates()
        .then((r) => {
          setTemplates(r.templates);
          setOffline(r.offline);
        })
        .catch((err) => setError(errorMessage(err)));
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      {offline ? <T variant="muted">Sem conexão: mostrando as favoritas salvas no aparelho. Editar exige internet.</T> : null}
      <ErrorText>{error}</ErrorText>
      {templates && templates.length === 0 ? (
        <Empty title="Nenhuma refeição favorita" hint='Registre uma refeição na aba Nutrição e toque em "Salvar como favorita".' />
      ) : null}
      {templates?.map((t) => (
        <Pressable key={t.id} accessibilityRole="button" onPress={() => router.push(`/favorites/${t.id}` as never)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Card style={{ gap: 2 }}>
            <T variant="h2">{t.name}</T>
            <T variant="muted">{`${t.mealType ? `${MEAL_LABELS[t.mealType]} · ` : ''}${fmt0(t.totals.kcal)} kcal`}</T>
            <T variant="muted">{t.items.map((i) => foodLabel(i)).join(' · ')}</T>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
