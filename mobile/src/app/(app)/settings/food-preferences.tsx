import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CatalogStatus, FoodPreferencesPicker, putFoodPreferences, savedPrefs, useFoodCatalog, type FoodPrefs } from '@/components/food-preferences';
import { Button, ErrorText, T } from '@/components/ui';
import { errorMessage, notify } from '@/lib/dialog';
import { isOffline } from '@/lib/offline';
import { space } from '@/theme';

/** Perfil > Minhas preferências: o mesmo seletor do onboarding, para refazer depois. */
export default function FoodPreferencesScreen() {
  const insets = useSafeAreaInsets();
  const { catalog, loading, error, reload } = useFoodCatalog();
  const [value, setValue] = useState<FoodPrefs>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (catalog) setValue(savedPrefs(catalog));
  }, [catalog]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await putFoodPreferences(value);
      notify('Preferências salvas', 'Elas passam a valer nas próximas buscas e nos próximos planos criados pela IA.');
      router.back();
    } catch (err) {
      setSaveError(isOffline(err) ? 'Salvar exige internet.' : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
    >
      <T variant="muted">Os alimentos que você gosta sobem nas buscas e entram mais nos planos da IA; os que não gosta ficam por último e não entram nos planos.</T>
      <CatalogStatus loading={loading} error={error} onRetry={reload} />
      {catalog ? <FoodPreferencesPicker catalog={catalog} value={value} onChange={setValue} /> : null}
      <ErrorText>{saveError}</ErrorText>
      {catalog ? <Button title="Salvar preferências" onPress={save} loading={saving} /> : null}
    </ScrollView>
  );
}
