import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Button, Card, Chip, Input, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, notify } from '@/lib/dialog';
import { consumePickedFood } from '@/lib/food-pick';
import { defaultMeal, fmt0, localDate, MEAL_LABELS, MEAL_ORDER, parseDecimal } from '@/lib/format';
import { addFoodLogs, foodToCandidate, isOffline, type FoodLogDraft } from '@/lib/offline';
import type { FoodCandidate, MealType, Macros, RecognitionResult } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

interface Row {
  key: string;
  name: string;
  confidence: number;
  grams: string;
  estimated: Macros;
  candidates: FoodCandidate[];
  selectedId: string | null;
  included: boolean;
}

export default function Photo() {
  const c = useColors();
  const { meal, date } = useLocalSearchParams<{ meal?: string; date?: string }>();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [disclaimer, setDisclaimer] = useState('');
  const [mealType, setMealType] = useState<MealType>(defaultMeal());
  const [pending, setPending] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [slow, setSlow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickFor = useRef<string | null>(null);
  const started = useRef(false);

  const patch = (key: string, changes: Partial<Row>) =>
    setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...changes } : r)) ?? null);

  // Tirar/escolher a foto só a exibe; a análise começa em "Analisar foto".
  function pick(asset: ImagePicker.ImagePickerAsset) {
    setPhotoUri(asset.uri);
    setPending(asset);
    setRows(null);
    setError(null);
  }

  async function analyze() {
    if (!pending) return;
    setRows(null);
    setError(null);
    setSlow(false);
    setAnalyzing(true);
    try {
      // Base64 em JSON: o envio de Blob via fetch no React Native chega vazio/sem Content-Type em alguns aparelhos.
      const base64 = pending.base64;
      if (!base64) throw new Error('Não consegui ler a foto. Tire outra.');
      const mimeType = pending.mimeType && ALLOWED.includes(pending.mimeType) ? pending.mimeType : 'image/jpeg';
      if (__DEV__) console.log(`[photo] enviando ${mimeType}, ${Math.round(base64.length / 1024)} KB em base64`);
      const res = await api<RecognitionResult>('/nutrition/recognize', {
        method: 'POST',
        body: { imageBase64: base64, mimeType },
        timeoutMs: 60_000,
      });
      setDisclaimer(res.disclaimer);
      setRows(
        res.items.map((it, i) => ({
          key: `${i}-${it.recognized.name}`,
          name: it.recognized.name,
          confidence: it.recognized.confidence,
          grams: String(Math.round(it.recognized.estimatedGrams)),
          estimated: it.recognized.estimated,
          candidates: it.candidates,
          selectedId: it.candidates[0]?.foodId ?? null,
          included: true,
        })),
      );
    } catch (err) {
      setError(isOffline(err) ? 'Sem conexão: o reconhecimento por foto precisa de internet.' : errorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function capture(source: 'camera' | 'library') {
    setError(null);
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError('Permita o acesso à câmera nas configurações do aparelho, ou escolha uma foto da galeria.');
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, exif: false, base64: true };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled && result.assets[0]) pick(result.assets[0]);
  }

  // Depois de 10 s de análise, avisa que ainda está trabalhando.
  useEffect(() => {
    if (!analyzing) return;
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, [analyzing]);

  // Abre a câmera ao entrar na tela (uma vez).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    capture('camera').catch((err) => setError(errorMessage(err)));
  }, []);

  // Voltando da busca ("Buscar outro alimento"): troca o alimento do item.
  useFocusEffect(
    useCallback(() => {
      const food = consumePickedFood();
      const key = pickFor.current;
      if (food && key) {
        const cand = foodToCandidate(food);
        setRows((rs) =>
          rs?.map((r) =>
            r.key === key ? { ...r, candidates: [cand, ...r.candidates.filter((x) => x.foodId !== cand.foodId)], selectedId: cand.foodId } : r,
          ) ?? null,
        );
      }
      pickFor.current = null;
    }, []),
  );

  const selected = (r: Row) => r.candidates.find((x) => x.foodId === r.selectedId) ?? null;
  const kcalOf = (r: Row) => {
    const cand = selected(r);
    const g = parseDecimal(r.grams);
    return cand && g ? (cand.kcalPer100g * g) / 100 : null;
  };
  const savable = (rows ?? []).filter((r) => r.included && selected(r) && (parseDecimal(r.grams) ?? 0) > 0);
  const totalKcal = savable.reduce((sum, r) => sum + (kcalOf(r) ?? 0), 0);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const drafts: FoodLogDraft[] = savable.map((r) => {
        const grams = parseDecimal(r.grams)!;
        return {
          item: { foodId: r.selectedId!, mealType, quantityG: grams },
          preview: { name: selected(r)!.name, mealType, grams, kcal: kcalOf(r) ?? 0 },
        };
      });
      const today = localDate();
      const { queued } = await addFoodLogs(drafts, date || today, today, 'photo_ai');
      if (queued) notify('Salvo no aparelho', 'Sem conexão: os alimentos serão enviados quando houver internet.');
      router.navigate('/nutrition');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  void meal; // a refeição é escolhida abaixo, pré-selecionada pelo horário

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">Fotografe seu prato inteiro de cima, com boa iluminação.</T>
      <T variant="muted">Quanto mais visível cada alimento, mais precisa será a análise.</T>

      {photoUri ? (
        <Image source={{ uri: photoUri }} contentFit="cover" style={{ width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: c.card }} />
      ) : null}

      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Button title={photoUri ? 'Tirar outra' : 'Tirar foto'} kind="secondary" style={{ flex: 1 }} onPress={() => capture('camera')} disabled={analyzing} />
        <Button title="Galeria" kind="secondary" style={{ flex: 1 }} onPress={() => capture('library')} disabled={analyzing} />
      </View>

      {pending && !rows && !analyzing && !error ? <Button title="Analisar foto" onPress={analyze} /> : null}

      {analyzing ? (
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
          <ActivityIndicator color={c.primary} size="large" />
          <T style={{ fontWeight: '700' }}>Identificando alimentos...</T>
          {slow ? <T variant="muted">Isso pode levar alguns segundos...</T> : null}
        </View>
      ) : null}

      {error ? (
        <View style={{ gap: space.md }}>
          <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text>
          {pending ? <Button title="Tentar novamente" onPress={analyze} /> : null}
        </View>
      ) : null}

      {rows && rows.length === 0 ? <T variant="muted">Não encontrei comida na foto. Tente outra foto, com o prato bem visível.</T> : null}

      {rows && rows.length > 0 ? (
        <>
          <T variant="muted">{disclaimer}</T>
          {rows.map((r) => {
            const cand = selected(r);
            const kcal = kcalOf(r);
            return (
              <Card key={r.key} style={{ gap: space.sm, opacity: r.included ? 1 : 0.5 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                  <T variant="h2" style={{ flex: 1 }}>
                    {r.name}
                  </T>
                  <T variant="label">{`${Math.round(r.confidence * 100)}% de certeza`}</T>
                </View>

                {r.included ? (
                  <>
                    <Input label="Quantidade estimada (g)" value={r.grams} onChangeText={(v) => patch(r.key, { grams: v })} keyboardType="decimal-pad" selectTextOnFocus />
                    {r.candidates.length > 0 ? (
                      <>
                        <T variant="label">Corresponde a (tabela TACO)</T>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                          {r.candidates.map((x) => (
                            <Chip key={x.foodId} label={x.name} selected={r.selectedId === x.foodId} onPress={() => patch(r.key, { selectedId: x.foodId })} />
                          ))}
                        </View>
                      </>
                    ) : (
                      <T variant="muted">
                        {`Sem correspondência na tabela. Estimativa da IA: ${fmt0(r.estimated.kcal)} kcal. Busque o alimento para poder registrar.`}
                      </T>
                    )}
                    {cand && kcal !== null ? <T style={{ fontWeight: '700' }}>{`${fmt0(kcal)} kcal`}</T> : null}
                    <View style={{ flexDirection: 'row', gap: space.md }}>
                      <Button
                        title="Buscar outro alimento"
                        kind="secondary"
                        style={{ flex: 1 }}
                        onPress={() => {
                          pickFor.current = r.key;
                          router.push('/food/search?mode=pick' as never);
                        }}
                      />
                      <Button title="Remover" kind="ghost" onPress={() => patch(r.key, { included: false })} />
                    </View>
                  </>
                ) : (
                  <Button title="Incluir de volta" kind="ghost" onPress={() => patch(r.key, { included: true })} />
                )}
              </Card>
            );
          })}

          <Card style={{ gap: space.md }}>
            <T variant="h2">Refeição</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {MEAL_ORDER.map((m) => (
                <Chip key={m} label={MEAL_LABELS[m]} selected={mealType === m} onPress={() => setMealType(m)} />
              ))}
            </View>
          </Card>

          <Button
            title={savable.length > 0 ? `Salvar ${savable.length} ${savable.length === 1 ? 'item' : 'itens'} · ${fmt0(totalKcal)} kcal` : 'Nada para salvar'}
            onPress={save}
            loading={saving}
            disabled={savable.length === 0}
          />
        </>
      ) : null}
    </ScrollView>
  );
}
