import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { radius, space, useColors } from '@/theme';

export type Stance = 'like' | 'dislike';
/** Só gosto e não gosto; item ausente = indiferente. */
export type FoodPrefs = Record<string, Stance>;

interface Catalog {
  categories: { key: string; label: string }[];
  items: { key: string; label: string; category: string; stance: 'like' | 'dislike' | 'indifferent' }[];
}

/** Catálogo do servidor (GET /preferences/foods) e as respostas já salvas. Offline: `error` preenchido e catálogo nulo. */
export function useFoodCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await api<Catalog>('/preferences/foods'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { catalog, loading, error, reload: load };
}

export const savedPrefs = (catalog: Catalog): FoodPrefs => {
  const out: FoodPrefs = {};
  for (const i of catalog.items) if (i.stance !== 'indifferent') out[i.key] = i.stance;
  return out;
};

export const putFoodPreferences = (prefs: FoodPrefs) =>
  api('/preferences/foods', {
    method: 'PUT',
    body: {
      likes: Object.keys(prefs).filter((k) => prefs[k] === 'like'),
      dislikes: Object.keys(prefs).filter((k) => prefs[k] === 'dislike'),
    },
  });

/** indiferente -> gosto -> não gosto -> indiferente. */
const nextStance = (s: Stance | undefined): Stance | undefined => (s === undefined ? 'like' : s === 'like' ? 'dislike' : undefined);

/** Grade por categoria com chips de três estados e contador de marcados. */
export function FoodPreferencesPicker({ catalog, value, onChange }: { catalog: Catalog; value: FoodPrefs; onChange: (next: FoodPrefs) => void }) {
  const c = useColors();
  const marked = Object.keys(value).length;

  const toggle = (key: string) => {
    const next = { ...value };
    const s = nextStance(value[key]);
    if (s) next[key] = s;
    else delete next[key];
    onChange(next);
  };

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <T variant="muted">Toque para alternar: indiferente → gosto → não gosto. Quem não tem marca é indiferente.</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <T variant="label">{`${marked} ${marked === 1 ? 'marcado' : 'marcados'}`}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="heart" size={14} color={c.primary} />
            <T variant="label">Gosto</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="close-circle" size={14} color={c.danger} />
            <T variant="label">Não gosto</T>
          </View>
        </View>
      </View>

      {catalog.categories.map((cat) => (
        <View key={cat.key} style={{ gap: space.sm }}>
          <T variant="h2">{cat.label}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {catalog.items
              .filter((i) => i.category === cat.key)
              .map((i) => {
                const s = value[i.key];
                const bg = s === 'like' ? c.primary : s === 'dislike' ? c.danger : c.card;
                const fg = s ? c.onPrimary : c.text;
                return (
                  <Pressable
                    key={i.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${i.label}: ${s === 'like' ? 'gosto' : s === 'dislike' ? 'não gosto' : 'indiferente'}`}
                    onPress={() => toggle(i.key)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: bg,
                      borderColor: s ? bg : c.border,
                      borderWidth: 1,
                      borderRadius: radius.button * 2,
                      paddingHorizontal: space.md,
                      paddingVertical: space.sm,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    {s ? <Ionicons name={s === 'like' ? 'heart' : 'close-circle'} size={14} color={fg} /> : null}
                    <Text style={{ color: fg, fontSize: 15, fontWeight: '600' }}>{i.label}</Text>
                  </Pressable>
                );
              })}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Estado de carregamento / erro do catálogo, com "Tentar novamente". */
export function CatalogStatus({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <T variant="muted">Carregando a lista de alimentos…</T>;
  if (!error) return null;
  return (
    <View style={{ gap: space.sm }}>
      <T variant="muted">{`Não foi possível carregar a lista (${error}). Você pode pular esta etapa e responder depois em Perfil > Minhas preferências.`}</T>
      <Button title="Tentar novamente" kind="secondary" onPress={onRetry} />
    </View>
  );
}
