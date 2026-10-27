import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, ErrorText, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { fmt1 } from '@/lib/format';
import type { LogDetail } from '@/lib/types';
import { space } from '@/theme';

const km = (n: number) => `${fmt1(n)} km`;
const min = (n: number) => `${n} min`;

export default function LogDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [log, setLog] = useState<LogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LogDetail>(`/workout/logs/${id}`)
      .then(setLog)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  const when = log ? new Date(log.performedAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : '';

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.lg }}>
      <ErrorText>{error}</ErrorText>
      {log ? (
        <>
          <T variant="muted">{when}</T>
          {log.perceivedEffort ? <T variant="muted">{`Esforço percebido: ${log.perceivedEffort}/10`}</T> : null}
          {log.notes ? <T>{log.notes}</T> : null}
          {log.sets.map((s) => {
            const p = s.prescribed;
            const d = s.done;
            const cardio = p.reps === null;
            const prescribed = cardio
              ? [p.durationMin ? min(p.durationMin) : null, p.distanceKm ? km(p.distanceKm) : null].filter(Boolean).join(' · ')
              : `${p.sets} × ${p.reps}${p.loadKg !== null ? ` · ${fmt1(p.loadKg)} kg` : ''}`;
            const done = cardio
              ? [d.durationMin !== null ? min(d.durationMin) : null, d.distanceKm !== null ? km(d.distanceKm) : null].filter(Boolean).join(' · ') ||
                'concluído'
              : `${d.sets} série(s)${d.reps !== null ? ` × ${d.reps}` : ''}${d.loadKg !== null ? ` · ${fmt1(d.loadKg)} kg` : ''}`;
            return (
              <Card key={s.setId} style={{ gap: space.xs }}>
                <T variant="h2">{s.exercise}</T>
                <T variant="muted">{`Prescrito: ${prescribed}`}</T>
                <T>{`Feito: ${done}`}</T>
              </Card>
            );
          })}
        </>
      ) : error ? null : (
        <T variant="muted">Carregando…</T>
      )}
    </ScrollView>
  );
}
