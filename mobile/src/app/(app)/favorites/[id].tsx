import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, ErrorText, Input, T } from '@/components/ui';
import { api } from '@/lib/api';
import { confirm, errorMessage, notify } from '@/lib/dialog';
import { FoodPickerModal, type Serving } from '@/components/food-picker';
import { foodLabel, MEAL_LABELS, MEAL_ORDER, parseDecimal } from '@/lib/format';
import { isOffline, loadTemplates } from '@/lib/offline';
import type { Food, MealTemplate, MealType } from '@/lib/types';
import { space, useColors } from '@/theme';

interface Row {
  key: string;
  foodId: string;
  label: string;
  grams: string;
}

/** Edição de uma refeição favorita: nome, refeição, alimentos e quantidades (PUT /nutrition/templates/:id). Exige internet. */
export default function EditFavorite() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [mealType, setMealType] = useState<MealType | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTemplates()
      .then(({ templates, offline }) => {
        const t = templates.find((x: MealTemplate) => x.id === id);
        if (!t) {
          setError('Refeição favorita não encontrada.');
          return;
        }
        if (offline) setError('Sem conexão: você pode ver a favorita, mas salvar exige internet.');
        setName(t.name);
        setMealType(t.mealType);
        setRows(t.items.map((i, n) => ({ key: `${i.foodId}-${n}`, foodId: i.foodId, label: foodLabel(i), grams: String(i.quantityG).replace('.', ',') })));
        setLoaded(true);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  const [adding, setAdding] = useState(false);

  const setGrams = (key: string, grams: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, grams } : r)));

  /** Recebe o alimento escolhido no painel de busca (entra com a quantidade informada ali). */
  async function addFood(food: Food, serving: Serving): Promise<string | null> {
    // A favorita guarda gramas; porção caseira entra como o total em gramas.
    setRows((rs) => [...rs, { key: `new-${Date.now()}`, foodId: food.id, label: foodLabel(food), grams: String(serving.grams).replace('.', ',') }]);
    return null;
  }

  async function save() {
    setError(null);
    if (name.trim().length === 0) return setError('Dê um nome para a favorita.');
    if (rows.length === 0) return setError('A favorita precisa de ao menos um alimento.');
    const items: { foodId: string; quantityG: number }[] = [];
    for (const r of rows) {
      const g = parseDecimal(r.grams);
      if (g === null || g <= 0 || g > 5000) return setError(`Quantidade inválida em "${r.label}": use gramas entre 1 e 5000.`);
      items.push({ foodId: r.foodId, quantityG: g });
    }
    setSaving(true);
    try {
      await api(`/nutrition/templates/${id}`, { method: 'PUT', body: { name: name.trim(), ...(mealType ? { mealType } : {}), items } });
      await loadTemplates().catch(() => undefined); // atualiza a cópia salva no aparelho
      router.back();
    } catch (err) {
      setError(isOffline(err) ? 'Salvar exige internet.' : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!(await confirm('Excluir favorita', `Excluir "${name}"?`, 'Excluir'))) return;
    try {
      await api(`/nutrition/templates/${id}`, { method: 'DELETE' });
      await loadTemplates().catch(() => undefined);
      router.back();
    } catch (err) {
      notify('Erro', isOffline(err) ? 'Excluir exige internet.' : errorMessage(err));
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
    >
      {loaded ? (
        <>
          <Input label="Nome" value={name} onChangeText={setName} maxLength={80} />

          <View style={{ gap: space.sm }}>
            <T variant="label">Refeição (opcional)</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {MEAL_ORDER.map((m) => (
                <Chip key={m} label={MEAL_LABELS[m]} selected={mealType === m} onPress={() => setMealType(mealType === m ? null : m)} />
              ))}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <T variant="h2">Alimentos</T>
            {rows.map((r) => (
              <Card key={r.key} style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
                  <T style={{ flex: 1 }}>{r.label}</T>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${r.label}`} hitSlop={8} onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    <Ionicons name="trash-outline" size={20} color={c.muted} />
                  </Pressable>
                </View>
                <Input label="Quantidade (g)" value={r.grams} onChangeText={(v) => setGrams(r.key, v)} keyboardType="decimal-pad" />
              </Card>
            ))}
            <Button title="+ Adicionar alimento" kind="secondary" onPress={() => setAdding(true)} />
          </View>
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
      {loaded ? (
        <>
          <Button title="Salvar alterações" onPress={save} loading={saving} />
          <Button title="Excluir favorita" kind="danger" onPress={remove} disabled={saving} />
        </>
      ) : null}
      <FoodPickerModal visible={adding} onClose={() => setAdding(false)} onConfirm={addFood} />
    </ScrollView>
  );
}
