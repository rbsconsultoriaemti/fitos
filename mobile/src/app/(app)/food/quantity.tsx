import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { Button, Card, Chip, ErrorText, Input, T } from '@/components/ui';
import { errorMessage, notify } from '@/lib/dialog';
import { defaultMeal, fmt0, fmt1, foodLabel, localDate, MEAL_LABELS, MEAL_ORDER, parseDecimal } from '@/lib/format';
import { addFoodLogs, getFood } from '@/lib/offline';
import type { Food, MealType } from '@/lib/types';
import { space, useColors } from '@/theme';

type Mode = 'grams' | 'portion';

export default function Quantity() {
  const c = useColors();
  const { foodId, meal, date } = useLocalSearchParams<{ foodId: string; meal?: string; date?: string }>();
  const [food, setFood] = useState<Food | null>(null);
  const [mode, setMode] = useState<Mode>('grams');
  const [grams, setGrams] = useState('100');
  const [portionLabel, setPortionLabel] = useState<string | null>(null);
  const [count, setCount] = useState('1');
  const [mealType, setMealType] = useState<MealType>(
    (MEAL_ORDER as readonly string[]).includes(meal ?? '') ? (meal as MealType) : defaultMeal(),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFood(foodId)
      .then((f) => {
        setFood(f);
        setPortionLabel(f.portions[0]?.label ?? null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [foodId]);

  if (!food) {
    return (
      <View style={{ padding: space.lg }}>
        {error ? <ErrorText>{error}</ErrorText> : <T variant="muted">Carregando…</T>}
      </View>
    );
  }

  const portion = food.portions.find((p) => p.label === portionLabel) ?? null;
  const portionCount = parseDecimal(count);
  const totalGrams =
    mode === 'grams' ? parseDecimal(grams) : portion && portionCount ? portion.grams * portionCount : null;
  const valid = totalGrams !== null && totalGrams > 0 && totalGrams <= 5000;

  // Prévia em tempo real: valores da tabela são por 100 g.
  const f = valid ? totalGrams / 100 : 0;
  const preview = {
    kcal: food.kcalPer100g * f,
    protein: food.proteinPer100g * f,
    carb: food.carbPer100g * f,
    fat: food.fatPer100g * f,
  };

  async function save() {
    if (!food || !valid || totalGrams === null) return;
    setSaving(true);
    setError(null);
    try {
      const today = localDate();
      const { queued } = await addFoodLogs(
        [
          {
            item:
              mode === 'portion' && portion && portionCount
                ? { foodId: food.id, mealType, portion: { label: portion.label, count: portionCount } }
                : { foodId: food.id, mealType, quantityG: totalGrams },
            preview: { name: foodLabel(food), mealType, grams: totalGrams, kcal: preview.kcal },
          },
        ],
        date || today,
        today,
      );
      if (queued) notify('Salvo no aparelho', 'Sem conexão: o alimento será enviado quando houver internet.');
      router.navigate('/nutrition');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <T variant="title">{foodLabel(food)}</T>
        <ErrorText>{error}</ErrorText>

        <Card style={{ gap: space.md }}>
          <T variant="h2">Quantidade</T>
          {food.portions.length > 0 ? (
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
                {food.portions.map((p) => (
                  <Chip key={p.label} label={`1 ${p.label} (${fmt0(p.grams)} g)`} selected={portionLabel === p.label} onPress={() => setPortionLabel(p.label)} />
                ))}
              </View>
              <Input label="Quantas porções" value={count} onChangeText={setCount} keyboardType="decimal-pad" selectTextOnFocus />
              {valid ? <T variant="muted">{`= ${fmt0(totalGrams)} g`}</T> : null}
            </>
          )}
        </Card>

        <Card style={{ gap: space.sm }}>
          <T variant="h2">Valores desta quantidade</T>
          <T variant="number">{`${fmt0(preview.kcal)} kcal`}</T>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T style={{ color: c.protein, fontWeight: '700' }}>{`Proteína ${fmt1(preview.protein)} g`}</T>
            <T style={{ color: c.carb, fontWeight: '700' }}>{`Carb ${fmt1(preview.carb)} g`}</T>
            <T style={{ color: c.fat, fontWeight: '700' }}>{`Gordura ${fmt1(preview.fat)} g`}</T>
          </View>
        </Card>

        <Card style={{ gap: space.md }}>
          <T variant="h2">Refeição</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {MEAL_ORDER.map((m) => (
              <Chip key={m} label={MEAL_LABELS[m]} selected={mealType === m} onPress={() => setMealType(m)} />
            ))}
          </View>
        </Card>

        <Button title="Salvar" onPress={save} loading={saving} disabled={!valid} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
