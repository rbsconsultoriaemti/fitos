import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Highlight } from '@/components/highlight';
import { Button, Card, Chip, ErrorText, Input, T } from '@/components/ui';
import { errorMessage } from '@/lib/dialog';
import { fmt0, foodLabel, parseDecimal } from '@/lib/format';
import { getRecentFoods, rememberFood, searchFoods } from '@/lib/offline';
import type { Food } from '@/lib/types';
import { space, useColors } from '@/theme';

const DEBOUNCE_MS = 350;

/** Quantidade escolhida: sempre em gramas (total) e, se for porção caseira, também a porção e a contagem. */
export interface Serving {
  grams: number;
  portion: { label: string; count: number } | null;
}

/**
 * Busca de alimento em painel por cima da tela atual (não troca de tela).
 * Escolhido o alimento, pede a quantidade em gramas e chama `onConfirm`.
 * `onConfirm` devolve a mensagem de erro, ou null quando deu certo (aí o painel fecha).
 */
export function FoodPickerModal({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (food: Food, serving: Serving) => Promise<string | null>;
}) {
  const insets = useSafeAreaInsets();
  const c = useColors();
  const [q, setQ] = useState('');
  const [foods, setFoods] = useState<Food[]>([]);
  const [recent, setRecent] = useState<Food[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Food | null>(null);
  const [mode, setMode] = useState<'grams' | 'portion'>('grams');
  const [grams, setGrams] = useState('100');
  const [portionLabel, setPortionLabel] = useState<string | null>(null);
  const [count, setCount] = useState('1');
  const [saving, setSaving] = useState(false);
  const request = useRef(0);

  // Ao abrir, começa limpo.
  useEffect(() => {
    if (!visible) return;
    setQ('');
    setChosen(null);
    setMode('grams');
    setGrams('100');
    setCount('1');
    setError(null);
    getRecentFoods().then(setRecent).catch(() => undefined);
  }, [visible]);

  // Debounce: só consulta depois que a pessoa para de digitar; respostas antigas são descartadas.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      request.current++;
      setFoods([]);
      setLoading(false);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchFoods(term);
        if (id !== request.current) return;
        setFoods(res.foods);
        setError(null);
      } catch (err) {
        if (id === request.current) setError(errorMessage(err));
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const searching = q.trim().length >= 2;
  const list = searching ? foods : recent;
  const portion = chosen?.portions.find((p) => p.label === portionLabel) ?? null;
  const portionCount = parseDecimal(count);
  const totalGrams = mode === 'grams' ? parseDecimal(grams) : portion && portionCount ? portion.grams * portionCount : null;
  const valid = totalGrams !== null && totalGrams > 0 && totalGrams <= 5000;

  async function confirm() {
    if (!chosen || !valid || totalGrams === null) return;
    setSaving(true);
    setError(null);
    await rememberFood(chosen);
    const serving: Serving = {
      grams: totalGrams,
      portion: mode === 'portion' && portion && portionCount ? { label: portion.label, count: portionCount } : null,
    };
    const err = await onConfirm(chosen, serving);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flex: 1, padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T variant="h2">{chosen ? 'Quantidade' : 'Adicionar alimento'}</T>
            <Button title="Fechar" kind="ghost" onPress={onClose} />
          </View>
          <ErrorText>{error}</ErrorText>

          {chosen ? (
            <>
              <Card style={{ gap: space.md }}>
                <T variant="h2">{foodLabel(chosen)}</T>
                <T variant="muted">{`${fmt0(chosen.kcalPer100g)} kcal / 100 g`}</T>
                {chosen.portions.length > 0 ? (
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Chip label="Gramas" selected={mode === 'grams'} onPress={() => setMode('grams')} />
                    <Chip label="Porção caseira" selected={mode === 'portion'} onPress={() => setMode('portion')} />
                  </View>
                ) : null}
                {mode === 'grams' ? (
                  <Input label="Gramas" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" selectTextOnFocus />
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                      {chosen.portions.map((p) => (
                        <Chip key={p.label} label={`1 ${p.label} (${fmt0(p.grams)} g)`} selected={portionLabel === p.label} onPress={() => setPortionLabel(p.label)} />
                      ))}
                    </View>
                    <Input label="Quantas porções" value={count} onChangeText={setCount} keyboardType="decimal-pad" selectTextOnFocus />
                    {valid ? <T variant="muted">{`= ${fmt0(totalGrams)} g`}</T> : null}
                  </>
                )}
              </Card>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button title="Trocar alimento" kind="secondary" style={{ flex: 1 }} onPress={() => setChosen(null)} />
                <Button title="Adicionar" onPress={confirm} loading={saving} disabled={!valid} style={{ flex: 1 }} />
              </View>
            </>
          ) : (
            <>
              <Input
                placeholder="Buscar alimento (ex.: arroz cozido)"
                value={q}
                onChangeText={setQ}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {!searching ? (
                <T variant="muted">{recent.length > 0 ? 'Usados recentemente. Toque para escolher, ou digite para buscar outro.' : 'Digite ao menos 2 letras para buscar.'}</T>
              ) : null}
              {loading ? <T variant="muted">Buscando…</T> : null}
              <FlatList
                data={list}
                keyExtractor={(f) => f.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: space.sm }}
                ListEmptyComponent={searching && !loading && !error ? <T variant="muted">Nenhum alimento encontrado.</T> : undefined}
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setChosen(item);
                      setPortionLabel(item.portions[0]?.label ?? null);
                      setMode('grams');
                      setError(null);
                    }}
                  >
                    <Card style={{ gap: 2 }}>
                      <Highlight text={foodLabel(item)} query={searching ? q : ''} />
                      <T variant="muted">{`${fmt0(item.kcalPer100g)} kcal / 100 g${item.source === 'openfoodfacts' ? ' · produto' : ''}`}</T>
                    </Card>
                  </Pressable>
                )}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
