import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FavoriteFoodsField } from '@/components/favorite-foods-field';
import { Button, ErrorText, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, notify } from '@/lib/dialog';
import { isOffline } from '@/lib/offline';
import { parseFavorites } from '@/lib/onboarding';
import type { Profile } from '@/lib/types';
import { space } from '@/theme';

/** Perfil > Alimentos favoritos: o mesmo campo da etapa 5 do onboarding, editável sem refazer o cadastro. */
export default function FavoriteFoodsScreen() {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Profile>('/profile')
      .then((p) => {
        setProfile(p);
        const saved = p.onboarding?.answers?.favoriteFoods;
        setText(Array.isArray(saved) ? (saved as string[]).join(', ') : '');
      })
      .catch((err) => setError(isOffline(err) ? 'Sem conexão: editar os favoritos exige internet.' : errorMessage(err)));
  }, []);

  async function save() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      // `step` = a etapa que já estava salva, para não mexer em onde o questionário retoma.
      await api('/profile', { method: 'PUT', body: { onboarding: { step: profile.onboarding.step, answers: { favoriteFoods: parseFavorites(text) } } } });
      notify('Favoritos salvos', 'Eles passam a valer nos próximos planos criados pela IA.');
      router.back();
    } catch (err) {
      setError(isOffline(err) ? 'Salvar exige internet.' : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
    >
      <T variant="muted">Separe por vírgula. A IA usa estes alimentos para montar seu plano alimentar.</T>
      <FavoriteFoodsField value={text} onChange={setText} />
      <ErrorText>{error}</ErrorText>
      <Button title="Salvar favoritos" onPress={save} loading={saving} disabled={!profile} />
    </ScrollView>
  );
}
