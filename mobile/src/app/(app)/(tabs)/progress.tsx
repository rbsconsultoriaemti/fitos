import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { Card, ErrorText, Separator, T } from '@/components/ui';
import { errorMessage } from '@/lib/dialog';
import { addDays, fmt0, fmt1, isoWeekday, localDate, WEEKDAYS } from '@/lib/format';
import { loadHistory } from '@/lib/offline';
import type { LogSummary } from '@/lib/types';
import { space, useColors } from '@/theme';

// Data local (YYYY-MM-DD) de um instante ISO.
const dayOf = (iso: string) => localDate(new Date(iso));
const mondayOf = (date: string) => addDays(date, 1 - isoWeekday(new Date(`${date}T12:00:00`)));

function computeStats(logs: LogSummary[]) {
  const today = localDate();
  const weekStart = mondayOf(today);
  const monthStart = `${today.slice(0, 8)}01`;
  const days = logs.map((l) => dayOf(l.performedAt));

  // Semanas seguidas com pelo menos um treino (a semana atual não quebra a sequência se ainda estiver vazia).
  const weeks = new Set(days.map(mondayOf));
  let streak = 0;
  for (let w = weeks.has(weekStart) ? weekStart : addDays(weekStart, -7); weeks.has(w); w = addDays(w, -7)) streak++;

  const inMonth = logs.filter((_, i) => days[i] >= monthStart);
  return {
    week: days.filter((d) => d >= weekStart).length,
    month: inMonth.length,
    streak,
    volumeMonth: inMonth.reduce((sum, l) => sum + l.volumeKg, 0),
    kmMonth: inMonth.reduce((sum, l) => sum + l.distanceKm, 0),
    minMonth: inMonth.reduce((sum, l) => sum + l.durationMin, 0),
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1, minWidth: '45%' }}>
      <T variant="label">{label}</T>
      <T variant="number">{value}</T>
    </Card>
  );
}

export default function Progress() {
  const c = useColors();
  const [logs, setLogs] = useState<LogSummary[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await loadHistory();
      setLogs(res.logs);
      setOffline(res.offline);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const stats = useMemo(() => (logs ? computeStats(logs) : null), [logs]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
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
      {offline ? <T variant="muted">Sem conexão: mostrando o último histórico salvo.</T> : null}

      {stats ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            <Stat label="Treinos na semana" value={String(stats.week)} />
            <Stat label="Treinos no mês" value={String(stats.month)} />
            <Stat label="Semanas seguidas" value={String(stats.streak)} />
            <Stat label="Volume no mês" value={`${fmt0(stats.volumeMonth)} kg`} />
            {stats.kmMonth > 0 || stats.minMonth > 0 ? (
              <Stat label="Cardio no mês" value={`${fmt1(stats.kmMonth)} km · ${fmt0(stats.minMonth)} min`} />
            ) : null}
          </View>

          <T variant="h2">Histórico</T>
          {logs && logs.length === 0 ? <T variant="muted">Nenhum treino finalizado ainda.</T> : null}
          {logs && logs.length > 0 ? (
            <Card style={{ paddingHorizontal: 0, paddingVertical: 0, gap: 0, overflow: 'hidden' }}>
            {logs.map((l, i) => {
            const [, m, day] = dayOf(l.performedAt).split('-');
            const title = [l.dayOfWeek ? WEEKDAYS[l.dayOfWeek - 1] : null, l.muscleGroup].filter(Boolean).join(' · ') || 'Treino';
            return (
              <View key={l.id}>
                {i > 0 ? <Separator style={{ marginLeft: space.lg }} /> : null}
              <Pressable disabled={offline} onPress={() => router.push(`/log/${l.id}` as never)} style={({ pressed }) => ({ gap: space.xs, padding: space.lg, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <T variant="h2">{title}</T>
                    <T variant="muted">{`${day}/${m}`}</T>
                  </View>
                  <T variant="muted">
                    {[
                      `${l.setsDone} séries`,
                      l.volumeKg > 0 ? `${fmt0(l.volumeKg)} kg` : null,
                      l.distanceKm > 0 ? `${fmt1(l.distanceKm)} km` : null,
                      l.durationMin > 0 ? `${l.durationMin} min` : null,
                      l.perceivedEffort ? `esforço ${l.perceivedEffort}/10` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                  {!offline ? (
                    <T variant="label" style={{ color: c.primary }}>
                      Ver detalhes
                    </T>
                  ) : null}
              </Pressable>
              </View>
            );
          })}
            </Card>
          ) : null}
        </>
      ) : error ? null : (
        <T variant="muted">Carregando…</T>
      )}
    </ScrollView>
  );
}
