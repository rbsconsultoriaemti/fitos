import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FoodPickerModal, type Serving } from '@/components/food-picker';
import { Button, Card, ErrorText, Input, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { foodLabel, parseDecimal } from '@/lib/format';
import { isOffline } from '@/lib/offline';
import type { DietPlan, Food } from '@/lib/types';
import { space, useColors } from '@/theme';

const MAX_MEALS = 12;
const MAX_FOODS = 30;

interface FoodRow {
  key: string;
  foodId: string;
  label: string;
  grams: string;
}

interface MealRow {
  key: string;
  name: string;
  foods: FoodRow[];
}

let seq = 0;
const nextKey = () => `k${Date.now()}-${seq++}`;
const toText = (n: number) => String(n).replace('.', ',');

/**
 * Monta o próprio plano alimentar: nome, refeições e alimentos com quantidade em gramas.
 * Sem `id` cria um plano novo; com `id` edita o próprio plano ativo. Exige internet.
 */
export default function EditDietPlan() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState(!id);
  const [blocked, setBlocked] = useState(false); // plano que não pode ser editado aqui
  const [title, setTitle] = useState('Meu plano');
  const [targets, setTargets] = useState<DietPlan['targets'] | null>(null); // metas do plano (preservadas ao salvar)
  const [meals, setMeals] = useState<MealRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickingFor, setPickingFor] = useState<string | null>(null); // refeição que recebe o alimento escolhido

  useEffect(() => {
    if (!id) return;
    api<DietPlan>(`/nutrition/plans/${id}`)
      .then((p) => {
        if (p.source !== 'self' || p.status !== 'active') {
          setError('Só é possível editar o seu plano próprio ativo.');
          setBlocked(true);
          return;
        }
        setTitle(p.title);
        setTargets(p.targets);
        setMeals(
          p.meals.map((m) => ({
            key: nextKey(),
            name: m.name,
            foods: m.foods.map((f) => ({ key: nextKey(), foodId: f.food.id, label: foodLabel(f.food), grams: toText(f.quantityG) })),
          })),
        );
      })
      .catch((err) => {
        setError(isOffline(err) ? 'Sem conexão: não foi possível abrir o plano.' : errorMessage(err));
        setBlocked(true);
      })
      .finally(() => setLoaded(true));
  }, [id]);

  const updateMeal = (mealKey: string, name: string) => setMeals((ms) => ms.map((m) => (m.key === mealKey ? { ...m, name } : m)));
  const removeMeal = (mealKey: string) => setMeals((ms) => ms.filter((m) => m.key !== mealKey));
  const addMeal = () => setMeals((ms) => [...ms, { key: nextKey(), name: `Refeição ${ms.length + 1}`, foods: [] }]);
  const setGrams = (mealKey: string, foodKey: string, grams: string) =>
    setMeals((ms) =>
      ms.map((m) => (m.key !== mealKey ? m : { ...m, foods: m.foods.map((f) => (f.key === foodKey ? { ...f, grams } : f)) })),
    );
  const removeFood = (mealKey: string, foodKey: string) =>
    setMeals((ms) => ms.map((m) => (m.key !== mealKey ? m : { ...m, foods: m.foods.filter((f) => f.key !== foodKey) })));

  /** Recebe o alimento escolhido no painel de busca (entra com a quantidade informada ali). */
  async function addFood(food: Food, serving: Serving): Promise<string | null> {
    if (!pickingFor) return 'Refeição não encontrada.';
    const mealKey = pickingFor;
    // O plano guarda gramas; porção caseira entra como o total em gramas.
    setMeals((ms) =>
      ms.map((m) =>
        m.key !== mealKey
          ? m
          : { ...m, foods: [...m.foods, { key: nextKey(), foodId: food.id, label: foodLabel(food), grams: toText(serving.grams) }] },
      ),
    );
    setPickingFor(null);
    return null;
  }

  async function save() {
    setError(null);
    if (title.trim().length < 2) return setError('Dê um nome para o plano (mínimo 2 letras).');
    if (meals.length === 0) return setError('Adicione ao menos uma refeição.');

    const outMeals: { name: string; foods: { foodId: string; quantityG: number }[] }[] = [];
    for (const m of meals) {
      const name = m.name.trim();
      if (name.length < 2) return setError('Cada refeição precisa de um nome com ao menos 2 letras.');
      if (m.foods.length === 0) return setError(`Adicione alimentos em "${name}" ou remova a refeição.`);
      const foods: { foodId: string; quantityG: number }[] = [];
      for (const f of m.foods) {
        const g = parseDecimal(f.grams);
        if (g === null || g <= 0 || g > 5000) return setError(`Quantidade inválida em "${f.label}": use gramas entre 1 e 5000.`);
        foods.push({ foodId: f.foodId, quantityG: g });
      }
      outMeals.push({ name, foods });
    }

    // Metas do plano existente vão de volta para não serem apagadas pelo PUT.
    const t = targets ?? { kcal: null, proteinG: null, carbG: null, fatG: null };
    const body = {
      title: title.trim(),
      ...(t.kcal !== null ? { targetKcal: t.kcal } : {}),
      ...(t.proteinG !== null ? { targetProteinG: t.proteinG } : {}),
      ...(t.carbG !== null ? { targetCarbG: t.carbG } : {}),
      ...(t.fatG !== null ? { targetFatG: t.fatG } : {}),
      meals: outMeals,
    };

    setSaving(true);
    try {
      if (id) await api(`/nutrition/plans/${id}`, { method: 'PUT', body });
      else await api('/nutrition/plans', { method: 'POST', body });
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
      {loaded && !blocked ? (
        <>
          <Input label="Nome do plano" value={title} onChangeText={setTitle} maxLength={120} />

          {meals.length === 0 ? (
            <T variant="muted">Adicione as refeições do seu dia (por exemplo: café da manhã, almoço e jantar).</T>
          ) : null}

          {meals.map((m, i) => (
            <Card key={m.key} style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Input label={`Refeição ${i + 1}`} value={m.name} onChangeText={(v) => updateMeal(m.key, v)} maxLength={80} />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${m.name}`} hitSlop={8} onPress={() => removeMeal(m.key)}>
                  <Ionicons name="trash-outline" size={20} color={c.muted} />
                </Pressable>
              </View>

              {m.foods.map((f) => (
                <View key={f.key} style={{ gap: space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
                    <T style={{ flex: 1 }}>{f.label}</T>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${f.label}`} hitSlop={8} onPress={() => removeFood(m.key, f.key)}>
                      <Ionicons name="close-circle-outline" size={20} color={c.muted} />
                    </Pressable>
                  </View>
                  <Input label="Quantidade (g)" value={f.grams} onChangeText={(v) => setGrams(m.key, f.key, v)} keyboardType="decimal-pad" />
                </View>
              ))}

              <Button
                title="+ Adicionar alimento"
                kind="secondary"
                onPress={() => setPickingFor(m.key)}
                disabled={m.foods.length >= MAX_FOODS}
              />
            </Card>
          ))}

          <Button title="+ Adicionar refeição" kind="secondary" onPress={addMeal} disabled={meals.length >= MAX_MEALS} />
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
      {loaded && !blocked ? <Button title="Salvar plano" onPress={save} loading={saving} disabled={saving} /> : null}

      <FoodPickerModal visible={pickingFor !== null} onClose={() => setPickingFor(null)} onConfirm={addFood} />
    </ScrollView>
  );
}
