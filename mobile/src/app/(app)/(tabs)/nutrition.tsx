import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { DaySummary } from '@/components/day-summary';
import { EnergyCard } from '@/components/energy-card';
import { ApplyFavoriteModal, SaveFavoriteModal } from '@/components/favorites';
import { Button, Card, ErrorText, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { confirm, errorMessage, notify } from '@/lib/dialog';
import { addDays, dateLabel, fmt0, foodLabel, localDate, MEAL_LABELS, MEAL_ORDER } from '@/lib/format';
import { addFoodLogs, getPendingFoodLogs, isOffline, loadDay, loadTemplates, syncPendingFoodLogs, type PendingFoodLog } from '@/lib/offline';
import type { DayLog, LogEntry, MealTemplate, MealType } from '@/lib/types';
import { space, useColors } from '@/theme';

const quantityText = (e: LogEntry) =>
  e.portion ? `${e.portion.count} × ${e.portion.label} (${fmt0(e.quantityG)} g)` : `${fmt0(e.quantityG)} g`;

export default function Nutrition() {
  const c = useColors();
  const [date, setDate] = useState(localDate());
  const [day, setDay] = useState<DayLog | null>(null);
  const [pending, setPending] = useState<PendingFoodLog[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [saveFor, setSaveFor] = useState<MealType | null>(null); // refeição cujo conteúdo será salvo como favorita
  const [applyFor, setApplyFor] = useState<MealType | null>(null); // refeição que receberá uma favorita

  const load = useCallback(async (d: string) => {
    try {
      // Registros feitos sem sinal sobem assim que houver conexão.
      if ((await syncPendingFoodLogs()) > 0) notify('Sincronizado', 'Os alimentos registrados offline foram enviados.');
      const res = await loadDay(d);
      setDay(res.day);
      setOffline(res.offline);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
    setPending((await getPendingFoodLogs()).filter((p) => p.date === d));
    loadTemplates().then((r) => setTemplates(r.templates)).catch(() => undefined);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [load, date]),
  );

  const go = (d: string) => {
    setLoaded(false);
    setDay(null);
    setDate(d);
  };

  async function remove(entry: LogEntry) {
    if (!(await confirm('Remover alimento', `Remover "${foodLabel(entry.food)}" desta refeição?`, 'Remover'))) return;
    try {
      await api(`/nutrition/logs/${entry.id}`, { method: 'DELETE' });
      await load(date);
    } catch (err) {
      notify(isOffline(err) ? 'Sem conexão' : 'Erro', isOffline(err) ? 'Remover alimentos exige internet.' : errorMessage(err));
    }
  }

  const add = (meal: MealType) => router.push(`/food/search?meal=${meal}&date=${date}` as never);

  const saveMeal = saveFor ? day?.meals.find((m) => m.type === saveFor) : undefined;

  /** Salva os alimentos da refeição do dia como favorita. Devolve a mensagem de erro, se houver. */
  async function saveFavorite(name: string): Promise<string | null> {
    if (!saveMeal) return 'Refeição não encontrada.';
    try {
      await api('/nutrition/templates', {
        method: 'POST',
        body: {
          name,
          mealType: saveMeal.type,
          items: saveMeal.entries.map((e) =>
            e.portion ? { foodId: e.food.id, portion: e.portion } : { foodId: e.food.id, quantityG: e.quantityG },
          ),
        },
      });
      setTemplates((await loadTemplates()).templates);
      setSaveFor(null);
      notify('Favorita salva', `"${name}" já está em Favoritas.`);
      return null;
    } catch (err) {
      if (isOffline(err)) return 'Salvar uma favorita exige internet.';
      return err instanceof ApiError && err.status === 409 ? 'Você já tem uma favorita com esse nome.' : errorMessage(err);
    }
  }

  /** Registra todos os alimentos da favorita na refeição escolhida (funciona offline: entra na fila). */
  async function applyFavorite(t: MealTemplate): Promise<string | null> {
    if (!applyFor) return null;
    try {
      const today = localDate();
      const mealType = applyFor;
      const { queued } = await addFoodLogs(
        t.items.map((i) => ({
          item: i.portion
            ? { foodId: i.foodId, mealType, portion: i.portion }
            : { foodId: i.foodId, mealType, quantityG: i.quantityG },
          preview: { name: foodLabel(i), mealType, grams: i.quantityG, kcal: i.kcal },
        })),
        date,
        today,
      );
      setApplyFor(null);
      if (queued) notify('Salvo no aparelho', 'Sem conexão: os alimentos serão enviados quando houver internet.');
      await load(date);
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  async function deleteFavorite(t: MealTemplate) {
    if (!(await confirm('Excluir favorita', `Excluir "${t.name}"?`, 'Excluir'))) return;
    try {
      await api(`/nutrition/templates/${t.id}`, { method: 'DELETE' });
      setTemplates((await loadTemplates()).templates);
    } catch (err) {
      notify('Erro', errorMessage(err));
    }
  }

  const pendingKcal = pending.reduce((sum, p) => sum + p.preview.kcal, 0);

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 640, width: '100%', alignSelf: 'center' }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load(date);
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable accessibilityLabel="Dia anterior" hitSlop={12} onPress={() => go(addDays(date, -1))}>
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <T variant="h2">{dateLabel(date)}</T>
        <Pressable
          accessibilityLabel="Próximo dia"
          hitSlop={12}
          disabled={date >= localDate()}
          onPress={() => go(addDays(date, 1))}
          style={{ opacity: date >= localDate() ? 0.3 : 1 }}
        >
          <Ionicons name="chevron-forward" size={26} color={c.text} />
        </Pressable>
      </View>

      <ErrorText>{error}</ErrorText>
      {offline ? <T variant="muted">Sem conexão: mostrando o último resumo salvo neste aparelho.</T> : null}

      {day ? <EnergyCard day={day} onChanged={() => load(date)} /> : null}

      <Button
        title="📷  Foto → calorias"
        kind="secondary"
        disabled={offline}
        onPress={() => router.push(`/food/photo?meal=${MEAL_ORDER[0]}&date=${date}` as never)}
      />

      {day ? (
        <DaySummary day={day} />
      ) : loaded && !error ? (
        <Card>
          <T variant="muted">
            {offline ? 'Este dia ainda não foi aberto com internet, então não há cópia salva.' : 'Nada registrado neste dia.'}
          </T>
        </Card>
      ) : null}

      {pending.length > 0 ? (
        <Card style={{ gap: space.xs, borderColor: c.warn }}>
          <T variant="h2">{`Aguardando envio (${pending.length})`}</T>
          <T variant="muted">{`≈ ${fmt0(pendingKcal)} kcal registradas sem sinal. Enviam sozinhas quando a conexão voltar e ainda não entram no resumo acima.`}</T>
          {pending.map((p) => (
            <View key={p.localId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T style={{ flex: 1 }}>{`${MEAL_LABELS[p.preview.mealType]} · ${p.preview.name}`}</T>
              <T variant="muted">{`${fmt0(p.preview.kcal)} kcal`}</T>
            </View>
          ))}
        </Card>
      ) : null}

      {MEAL_ORDER.map((type) => {
        const meal = day?.meals.find((m) => m.type === type);
        const hasEntries = !!meal && meal.entries.length > 0;
        return (
          <Card key={type} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <T variant="h2">{MEAL_LABELS[type]}</T>
                {hasEntries ? <T variant="muted">{`${fmt0(meal.totals.kcal)} kcal`}</T> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Adicionar alimento em ${MEAL_LABELS[type]}`} hitSlop={8} onPress={() => add(type)}>
                <Ionicons name="add-circle" size={34} color={c.primary} />
              </Pressable>
            </View>
            {meal?.entries.map((e) => (
              <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <T>{foodLabel(e.food)}</T>
                  <T variant="muted">{quantityText(e)}</T>
                </View>
                <T variant="label">{`${fmt0(e.kcal)} kcal`}</T>
                <Pressable accessibilityLabel={`Remover ${foodLabel(e.food)}`} hitSlop={8} onPress={() => remove(e)}>
                  <Ionicons name="trash-outline" size={20} color={c.muted} />
                </Pressable>
              </View>
            ))}
            {meal && !hasEntries ? <T variant="muted">Nada registrado.</T> : null}
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {hasEntries ? (
                <Button title="★ Salvar como favorita" kind="ghost" disabled={offline} onPress={() => setSaveFor(type)} />
              ) : null}
              <Button title="Favoritas" kind="ghost" onPress={() => setApplyFor(type)} />
            </View>
          </Card>
        );
      })}

      <SaveFavoriteModal
        visible={saveFor !== null}
        mealLabel={saveFor ? MEAL_LABELS[saveFor] : ''}
        itemCount={saveMeal?.entries.length ?? 0}
        kcal={saveMeal?.totals.kcal ?? 0}
        onSave={saveFavorite}
        onClose={() => setSaveFor(null)}
      />
      <ApplyFavoriteModal
        visible={applyFor !== null}
        mealLabel={applyFor ? MEAL_LABELS[applyFor] : ''}
        templates={templates}
        offline={offline}
        onApply={applyFavorite}
        onDelete={deleteFavorite}
        onClose={() => setApplyFor(null)}
      />
    </ScrollView>
  );
}
