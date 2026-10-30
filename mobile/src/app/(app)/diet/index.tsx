import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Button, Card, Empty, ErrorText, Separator, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { fmt0, foodLabel } from '@/lib/format';
import { isOffline } from '@/lib/offline';
import type { ActiveDietPlans, DietPlan } from '@/lib/types';
import { space } from '@/theme';

const SOURCE_LABEL: Record<DietPlan['source'], string> = {
  nutritionist: 'Do seu nutricionista',
  self: 'Plano próprio',
  ai: 'Sugestão da IA',
};

const targetsText = (t: DietPlan['targets']) => {
  const parts: string[] = [];
  if (t.kcal !== null) parts.push(`${fmt0(t.kcal)} kcal`);
  if (t.proteinG !== null) parts.push(`P ${fmt0(t.proteinG)} g`);
  if (t.carbG !== null) parts.push(`C ${fmt0(t.carbG)} g`);
  if (t.fatG !== null) parts.push(`G ${fmt0(t.fatG)} g`);
  return parts.length > 0 ? parts.join(' · ') : null;
};

/** Conteúdo de um plano: metas, totais e as refeições com os alimentos. */
function PlanBody({ plan }: { plan: DietPlan }) {
  const targets = targetsText(plan.targets);
  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <T variant="h2">{plan.title}</T>
        <T variant="muted">{`${SOURCE_LABEL[plan.source]}${targets ? ` · Meta: ${targets}` : ''}`}</T>
      </View>
      <T variant="muted">{`Total do plano: ${fmt0(plan.totals.kcal)} kcal · P ${fmt0(plan.totals.proteinG)} g · C ${fmt0(plan.totals.carbG)} g · G ${fmt0(plan.totals.fatG)} g`}</T>
      {plan.meals.length === 0 ? <T variant="muted">Nenhuma refeição montada ainda.</T> : null}
      {plan.meals.map((m) => {
        const mealKcal = m.foods.reduce((sum, f) => sum + f.kcal, 0);
        return (
          <View key={m.id} style={{ gap: space.sm }}>
            <Separator />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
              <T variant="label">{m.timeSuggestion ? `${m.name} · ${m.timeSuggestion}` : m.name}</T>
              <T variant="muted">{`${fmt0(mealKcal)} kcal`}</T>
            </View>
            {m.foods.map((f) => (
              <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
                <T style={{ flex: 1 }}>{`${foodLabel(f.food)} · ${fmt0(f.quantityG)} g`}</T>
                <T variant="muted">{`${fmt0(f.kcal)} kcal`}</T>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** Tela da dieta: mostra o plano em uso e permite montar ou editar o próprio plano. */
export default function DietScreen() {
  const [data, setData] = useState<ActiveDietPlans | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<ActiveDietPlans>('/nutrition/plans/active'));
      setError(null);
    } catch (err) {
      setError(isOffline(err) ? 'Sem conexão: não foi possível carregar a dieta agora.' : errorMessage(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  // Recarrega ao voltar da tela de edição.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const active = data?.active ?? null;
  const own = data?.own ?? null;
  const ownIsActive = active?.source === 'self';

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <ErrorText>{error}</ErrorText>

      {loaded && !active && !own && !error ? (
        <Empty
          title="Você ainda não tem um plano alimentar"
          hint="Monte o seu com os alimentos que costuma comer. O plano do seu nutricionista, quando existir, passa a valer no lugar do seu."
        />
      ) : null}

      {active ? (
        <Card>
          <PlanBody plan={active} />
        </Card>
      ) : null}

      {active && !ownIsActive ? (
        <T variant="muted">Este plano é somente leitura. Seu plano próprio fica guardado e volta a valer se o plano em uso deixar de estar ativo.</T>
      ) : null}

      {own && ownIsActive ? <Button title="Editar meu plano" onPress={() => router.push(`/diet/edit?id=${own.id}` as never)} /> : null}

      {own && !ownIsActive ? (
        <Card style={{ gap: space.md }}>
          <View style={{ gap: 2 }}>
            <T variant="label">Meu plano próprio (guardado)</T>
            <T>{own.title}</T>
          </View>
          <Button title="Editar meu plano" kind="secondary" onPress={() => router.push(`/diet/edit?id=${own.id}` as never)} />
        </Card>
      ) : null}

      {loaded && !own && !error ? <Button title="Montar meu plano" onPress={() => router.push('/diet/edit' as never)} /> : null}
    </ScrollView>
  );
}
