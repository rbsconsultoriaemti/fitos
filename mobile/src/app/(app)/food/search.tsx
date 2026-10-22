import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Highlight } from '@/components/highlight';
import { Button, Card, ErrorText, Input, T } from '@/components/ui';
import { errorMessage } from '@/lib/dialog';
import { setPickedFood } from '@/lib/food-pick';
import { fmt0, foodLabel } from '@/lib/format';
import { getRecentFoods, rememberFood, searchFoods } from '@/lib/offline';
import type { Food } from '@/lib/types';
import { space, useColors } from '@/theme';

const DEBOUNCE_MS = 350;

export default function FoodSearch() {
  const c = useColors();
  const { meal, date, mode } = useLocalSearchParams<{ meal?: string; date?: string; mode?: string }>();
  const [q, setQ] = useState('');
  const [foods, setFoods] = useState<Food[]>([]);
  const [recent, setRecent] = useState<Food[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    getRecentFoods().then(setRecent);
  }, []);

  // Debounce: só consulta depois que a pessoa para de digitar; respostas antigas são descartadas.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      request.current++;
      setFoods([]);
      setLoading(false);
      setError(null);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchFoods(term);
        if (id !== request.current) return;
        setFoods(res.foods);
        setOffline(res.offline);
        setError(null);
      } catch (err) {
        if (id === request.current) setError(errorMessage(err));
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  async function choose(food: Food) {
    await rememberFood(food);
    if (mode === 'pick') {
      setPickedFood(food);
      router.back();
    } else {
      router.push(`/food/quantity?foodId=${food.id}&meal=${meal ?? ''}&date=${date ?? ''}` as never);
    }
  }

  const searching = q.trim().length >= 2;
  const list = searching ? foods : recent;

  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder="Buscar alimento (ex.: arroz cozido)"
            value={q}
            onChangeText={setQ}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {mode !== 'pick' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ler código de barras"
            onPress={() => router.push(`/food/barcode?meal=${meal ?? ''}&date=${date ?? ''}` as never)}
            style={{ height: 48, width: 48, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="barcode-outline" size={26} color={c.onPrimary} />
          </Pressable>
        ) : null}
      </View>
      <ErrorText>{error}</ErrorText>
      {offline && searching ? <T variant="muted">Sem conexão: buscando só entre os alimentos já usados neste aparelho.</T> : null}
      {loading ? <T variant="muted">Buscando…</T> : null}

      {!searching ? (
        recent.length > 0 ? (
          <View style={{ gap: 2 }}>
            <T variant="h2">Usados recentemente</T>
            <T variant="muted">Toque para adicionar de novo, ou digite para buscar outro alimento.</T>
          </View>
        ) : (
          <Card style={{ gap: space.xs }}>
            <T variant="h2">Comece pela busca</T>
            <T variant="muted">Digite ao menos 2 letras, ou use o ícone do código de barras para ler um produto. Os alimentos que você usar aparecerão aqui.</T>
          </Card>
        )
      ) : null}

      <FlatList
        data={list}
        keyExtractor={(f) => f.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.sm }}
        ListEmptyComponent={searching && !loading && !error ? <T variant="muted">Nenhum alimento encontrado.</T> : undefined}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => choose(item)}>
            <Card style={{ gap: 2, ...(searching ? {} : { borderColor: c.primary }) }}>
              <Highlight text={foodLabel(item)} query={searching ? q : ''} />
              <T variant="muted">
                {`${fmt0(item.kcalPer100g)} kcal / 100 g${item.source === 'openfoodfacts' ? ' · produto' : ''}`}
              </T>
            </Card>
          </Pressable>
        )}
      />
      {searching && foods.length === 0 && !loading && !error && mode !== 'pick' ? (
        <Button
          title="Ler código de barras"
          kind="secondary"
          onPress={() => router.push(`/food/barcode?meal=${meal ?? ''}&date=${date ?? ''}` as never)}
        />
      ) : null}
    </View>
  );
}
