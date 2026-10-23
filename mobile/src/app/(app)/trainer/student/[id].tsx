import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Avatar, StatusBadge } from '@/components/trainer-home';
import { Button, Card, ErrorText, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { LEVEL_LABELS, shortDate, WEEKDAYS } from '@/lib/format';
import type { TrainerStudentDetail } from '@/lib/types';
import { space, useColors } from '@/theme';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 90, gap: 2 }}>
      <T variant="label">{label}</T>
      <T variant="h2">{value}</T>
    </View>
  );
}

/** Barras simples: uma por semana, altura = % de aderência (verde ≥80, amarelo ≥50, vermelho abaixo). */
function AdherenceChart({ weeks }: { weeks: TrainerStudentDetail['weeklyAdherence'] }) {
  const c = useColors();
  const H = 100;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, height: H + 40 }}>
      {weeks.map((w) => {
        const pct = w.pct ?? 0;
        const color = w.pct === null ? c.track : pct >= 80 ? c.primary : pct >= 50 ? c.warn : c.danger;
        return (
          <View key={w.weekStart} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            <T variant="label" style={{ fontSize: 11 }}>
              {w.pct === null ? '–' : `${w.pct}%`}
            </T>
            <View style={{ width: '70%', height: Math.max(4, (H * pct) / 100), backgroundColor: color, borderRadius: 4 }} />
            <T variant="label" style={{ fontSize: 10 }}>
              {shortDate(w.weekStart)}
            </T>
          </View>
        );
      })}
    </View>
  );
}

export default function StudentProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const [data, setData] = useState<TrainerStudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<TrainerStudentDetail>(`/trainer/students/${id}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const s = data?.student;
  const plan = data?.plan;

  return (
    <>
      <Stack.Screen options={{ title: s?.name ?? 'Aluno' }} />
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
        {!data && !error ? <T variant="muted">Carregando…</T> : null}

        {data && s ? (
          <>
            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Avatar name={s.name} size={56} />
                <View style={{ flex: 1, gap: 4 }}>
                  <T variant="h2">{s.name}</T>
                  <StatusBadge status={data.todayStatus} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                <Fact label="Objetivo" value={s.goal ?? '—'} />
                <Fact label="Nível" value={s.fitnessLevel ? LEVEL_LABELS[s.fitnessLevel] : '—'} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                <Fact label="IMC" value={s.bmi ? `${s.bmi.toFixed(1).replace('.', ',')}${s.bmiCategory ? ` (${s.bmiCategory})` : ''}` : '—'} />
                <Fact label="Peso / altura" value={s.weightKg && s.heightCm ? `${String(s.weightKg).replace('.', ',')} kg · ${s.heightCm} cm` : '—'} />
              </View>
              <T variant="muted">
                {data.streak >= 1 ? `${data.streak} ${data.streak === 1 ? 'treino seguido' : 'treinos seguidos'}` : 'Sem sequência no momento'}
              </T>
            </Card>

            <Card style={{ gap: space.md }}>
              <T variant="h2">Aderência semanal</T>
              <AdherenceChart weeks={data.weeklyAdherence} />
              <T variant="muted">Dias de treino feitos ÷ dias de treino prescritos, por semana (início na segunda).</T>
            </Card>

            <Card style={{ gap: space.md }}>
              <T variant="h2">Plano de treino ativo</T>
              {!plan ? (
                <T variant="muted">O aluno ainda não tem um plano ativo.</T>
              ) : (
                <>
                  <T variant="body" style={{ fontWeight: '700' }}>
                    {plan.title}
                  </T>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {WEEKDAYS.map((label, i) => {
                      const on = plan.days.some((d) => d.dayOfWeek === i + 1);
                      return (
                        <View key={label} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: on ? c.primarySoft : c.track }}>
                          <T variant="label" style={{ color: on ? c.primary : c.muted }}>
                            {label}
                          </T>
                        </View>
                      );
                    })}
                  </View>
                  {[...plan.days]
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                    .map((d) => (
                      <View key={d.id} style={{ gap: 4, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
                        <T variant="body" style={{ fontWeight: '700' }}>
                          {WEEKDAYS[d.dayOfWeek - 1]} · {d.muscleGroup}
                        </T>
                        {d.sets.map((x) => (
                          <T key={x.id} variant="muted">
                            {x.exercise.name} —{' '}
                            {x.reps ? `${x.sets}×${x.reps}${x.loadKg ? ` · ${String(x.loadKg).replace('.', ',')} kg` : ''}` : [x.durationMin ? `${x.durationMin} min` : null, x.distanceKm ? `${x.distanceKm} km` : null].filter(Boolean).join(' · ')}
                          </T>
                        ))}
                      </View>
                    ))}
                </>
              )}
              <Button title="✏️ Prescrever treino" kind="secondary" onPress={() => router.push(`/trainer/prescribe/${s.id}` as never)} />
            </Card>

            <Card style={{ gap: space.sm }}>
              <T variant="h2">Últimos 7 treinos</T>
              {data.recentLogs.length === 0 ? <T variant="muted">Nenhum treino registrado ainda.</T> : null}
              {data.recentLogs.map((l) => (
                <Pressable key={l.id} onPress={() => router.push(`/log/${l.id}` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 }}>
                  <View style={{ flex: 1 }}>
                    <T variant="body" style={{ fontWeight: '600' }}>
                      {shortDate(l.date)} · {l.muscleGroup ?? 'Treino'}
                    </T>
                    <T variant="muted">
                      {l.setsDone}/{l.setsPrescribed} séries{l.perceivedEffort ? ` · esforço ${l.perceivedEffort}/10` : ''}
                    </T>
                  </View>
                  <T variant="h2" style={{ color: l.adherencePct === null ? c.muted : l.adherencePct >= 80 ? c.primary : l.adherencePct >= 50 ? c.warn : c.danger }}>
                    {l.adherencePct === null ? '–' : `${l.adherencePct}%`}
                  </T>
                </Pressable>
              ))}
              <T variant="muted">Aderência do treino = séries feitas ÷ séries prescritas.</T>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
