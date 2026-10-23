import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { TrainerHome } from '@/components/trainer-home';
import { DaySummary } from '@/components/day-summary';
import { WaterWidget } from '@/components/water-widget';
import { Button, Card, ErrorText, T } from '@/components/ui';
import { errorMessage } from '@/lib/dialog';
import { loadActivePlan, loadDay } from '@/lib/offline';
import { isoWeekday, localDate } from '@/lib/format';
import type { DayLog, WorkoutDay, WorkoutPlan } from '@/lib/types';
import { useSession } from '@/session';
import { space, useColors } from '@/theme';

interface TodayWorkout {
  plan: WorkoutPlan;
  day: WorkoutDay | null;
}

export default function Home() {
  const { user } = useSession();
  return user?.role === 'trainer' ? <TrainerHome /> : <StudentHome />;
}

function StudentHome() {
  const { user } = useSession();
  const c = useColors();
  const [day, setDay] = useState<DayLog | null>(null);
  const [workout, setWorkout] = useState<TodayWorkout | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { plan } = await loadActivePlan();
      setWorkout(plan ? { plan, day: plan.days.find((d) => d.dayOfWeek === isoWeekday()) ?? null } : null);
      const res = await loadDay(localDate());
      setDay(res.day);
      setError(res.offline ? 'Sem conexão: mostrando os dados salvos no aparelho.' : null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ gap: 2, flex: 1 }}>
          <T variant="title">Olá, {user?.name.split(' ')[0]}</T>
          <T variant="muted">Resumo de hoje</T>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notificações"
          hitSlop={8}
          onPress={() => router.push('/settings/notifications' as never)}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="notifications-outline" size={22} color={c.text} />
        </Pressable>
      </View>

      <ErrorText>{error}</ErrorText>

      {day ? <DaySummary day={day} /> : error ? null : <T variant="muted">Carregando…</T>}

      <WaterWidget />

      {workout !== undefined ? (
        <Card>
          <T variant="h2">Treino de hoje</T>
          {workout === null ? (
            <T variant="muted">Você ainda não tem um plano de treino ativo. Quando seu professor aprovar um, ele aparece aqui.</T>
          ) : workout.day ? (
            <>
              <T variant="body" style={{ fontWeight: '700' }}>
                {workout.day.muscleGroup} · {workout.day.sets.length} exercícios
              </T>
              <T variant="muted">{workout.plan.title}</T>
              <Button title="Iniciar treino" onPress={() => router.navigate('/workout')} />
            </>
          ) : (
            <>
              <T variant="muted">Hoje é dia de descanso no plano “{workout.plan.title}”.</T>
              <Button title="Ver plano" kind="secondary" onPress={() => router.navigate('/workout')} />
            </>
          )}
        </Card>
      ) : null}
    </ScrollView>
  );
}
