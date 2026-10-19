import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, TextInput, Vibration, View } from 'react-native';

import { Button, Card, Chip, Empty, ErrorText, T } from '@/components/ui';
import { errorMessage, notify } from '@/lib/dialog';
import { isoWeekday, mmss, parseDecimal, WEEKDAYS } from '@/lib/format';
import { getDraft, isOffline, loadActivePlan, queueLog, setDraft, syncPendingLogs, type PendingLog } from '@/lib/offline';
import { api } from '@/lib/api';
import type { WorkoutPlan, WorkoutSet } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

// A API guarda UMA carga e UMA contagem de reps por exercício (set_logs), não por série:
// por isso cada exercício tem um campo de carga/reps e N círculos de séries concluídas.
interface Progress {
  done: number;
  load: string;
  reps: string;
}

const initial = (s: WorkoutSet): Progress => ({
  done: 0,
  load: s.loadKg !== null ? String(s.loadKg).replace('.', ',') : '',
  reps: /^\d+$/.test(s.reps) ? s.reps : '',
});

export default function Workout() {
  const c = useColors();
  const [plan, setPlan] = useState<WorkoutPlan | null | undefined>(undefined);
  const [dayId, setDayId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [rest, setRest] = useState<number | null>(null); // instante (ms) em que o descanso termina
  const [now, setNow] = useState(Date.now());
  const [finishing, setFinishing] = useState(false);
  const [effort, setEffort] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  const load = useCallback(async () => {
    try {
      // Treinos finalizados sem sinal são enviados assim que a conexão voltar.
      const sent = await syncPendingLogs();
      if (sent > 0) notify('Treinos sincronizados', `${sent} treino(s) feito(s) offline foram enviados.`);
      const { plan: full, offline: off } = await loadActivePlan();
      setOffline(off);
      if (!full) return setPlan(null);
      setPlan(full);
      const draft = await getDraft();
      if (draft && draft.planId === full.id && full.days.some((d) => d.id === draft.dayId)) {
        setProgress(draft.progress);
        setStartedAt(draft.startedAt);
        setDayId(draft.dayId);
      } else {
        setDayId((cur) => cur ?? (full.days.find((d) => d.dayOfWeek === isoWeekday()) ?? full.days[0])?.id ?? null);
      }
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDraftReady(true);
    }
  }, []);

  // Salva o treino em andamento no aparelho a cada alteração (sobrevive ao app ser fechado).
  useEffect(() => {
    if (!draftReady || !plan || !dayId) return;
    const empty = startedAt === null && Object.keys(progress).length === 0;
    setDraft(empty ? null : { planId: plan.id, dayId, startedAt, progress });
  }, [draftReady, plan, dayId, startedAt, progress]);

  useFocusEffect(
    useCallback(() => {
      if (plan === undefined || offline) load();
    }, [load, plan, offline]),
  );

  // Relógio só corre enquanto há treino em andamento ou descanso ativo.
  useEffect(() => {
    if (startedAt === null && rest === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startedAt, rest]);

  useEffect(() => {
    if (rest !== null && now >= rest) {
      setRest(null);
      Vibration.vibrate(400);
    }
  }, [now, rest]);

  const day = plan?.days.find((d) => d.id === dayId) ?? null;
  const get = (s: WorkoutSet) => progress[s.id] ?? initial(s);
  const patch = (s: WorkoutSet, p: Partial<Progress>) => setProgress((cur) => ({ ...cur, [s.id]: { ...get(s), ...p } }));

  const toggleSerie = (s: WorkoutSet, n: number) => {
    const cur = get(s).done;
    patch(s, { done: cur >= n ? n - 1 : n });
    if (cur < n) {
      if (startedAt === null) setStartedAt(Date.now());
      if (s.restSeconds) {
        setNow(Date.now());
        setRest(Date.now() + s.restSeconds * 1000);
      }
    }
  };

  const totalSeries = day?.sets.reduce((a, s) => a + s.sets, 0) ?? 0;
  const doneSeries = day?.sets.reduce((a, s) => a + Math.min(get(s).done, s.sets), 0) ?? 0;

  const finish = async () => {
    if (!plan || !day) return;
    const sets = day.sets
      .filter((s) => get(s).done > 0)
      .map((s) => {
        const p = get(s);
        const load = parseDecimal(p.load);
        const reps = parseDecimal(p.reps);
        return {
          setId: s.id,
          setsDone: p.done,
          loadDoneKg: load !== null && load >= 0 ? load : undefined,
          repsDone: reps !== null && reps >= 0 ? Math.round(reps) : undefined,
        };
      });
    if (sets.length === 0) return notify('Nenhuma série marcada', 'Marque ao menos uma série antes de finalizar.');

    setSaving(true);
    const log: PendingLog = {
      planId: plan.id,
      dayId: day.id,
      performedAt: new Date(startedAt ?? Date.now()).toISOString(),
      perceivedEffort: effort ?? undefined,
      notes: notes.trim() || undefined,
      sets,
    };
    try {
      let savedOffline = false;
      try {
        await api('/workout/logs', { method: 'POST', body: log });
      } catch (err) {
        if (!isOffline(err)) throw err;
        await queueLog(log);
        savedOffline = true;
      }
      setFinishing(false);
      setProgress({});
      setStartedAt(null);
      setRest(null);
      setEffort(null);
      setNotes('');
      await setDraft(null);
      if (savedOffline) {
        notify('Treino salvo no aparelho', 'Sem conexão agora. Ele será enviado automaticamente quando houver sinal.');
      } else {
        notify('Treino registrado!', 'Bom trabalho. 💪');
      }
    } catch (err) {
      notify('Não foi possível salvar', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (plan === undefined) return <View style={{ padding: space.lg }}>{error ? <ErrorText>{error}</ErrorText> : <T variant="muted">Carregando…</T>}</View>;
  if (plan === null || !day) {
    return (
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Empty title="Nenhum treino ativo" hint="Quando seu professor aprovar um plano, ele aparece aqui. Puxe para atualizar." />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 140, maxWidth: 640, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <T variant="muted">{plan.title}</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {plan.days.map((d) => (
            <Chip key={d.id} label={`${WEEKDAYS[d.dayOfWeek - 1]} · ${d.muscleGroup}`} selected={d.id === dayId} onPress={() => setDayId(d.id)} />
          ))}
        </ScrollView>
        {offline ? <T variant="muted">Sem conexão — usando o treino salvo no aparelho.</T> : null}
        <ErrorText>{error}</ErrorText>
        {day.notes ? <T variant="muted">{day.notes}</T> : null}

        {day.sets.map((s) => {
          const p = get(s);
          const complete = p.done >= s.sets;
          return (
            <Card key={s.id} style={complete ? { backgroundColor: c.primarySoft, borderColor: c.primary } : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T variant="h2" style={{ flex: 1 }}>
                  {s.exercise.name}
                </T>
                {complete ? <Ionicons name="checkmark-circle" size={24} color={c.primary} /> : null}
              </View>
              <T variant="muted">
                {s.sets} × {s.reps}
                {s.loadKg !== null ? ` · ${s.loadKg} kg` : ''}
                {s.restSeconds ? ` · descanso ${s.restSeconds} s` : ''}
              </T>

              <View style={{ flexDirection: 'row', gap: space.md }}>
                <LabeledNumber label="Carga (kg)" value={p.load} onChange={(v) => patch(s, { load: v })} />
                <LabeledNumber label={`Reps (${s.reps})`} value={p.reps} onChange={(v) => patch(s, { reps: v })} />
              </View>

              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                {Array.from({ length: s.sets }, (_, i) => i + 1).map((n) => {
                  const on = p.done >= n;
                  return (
                    <Pressable
                      key={n}
                      accessibilityLabel={`Série ${n}`}
                      onPress={() => toggleSerie(s, n)}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        borderWidth: 2,
                        borderColor: on ? c.primary : c.border,
                        backgroundColor: on ? c.primary : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {on ? <Ionicons name="checkmark" size={24} color={c.onPrimary} /> : <T variant="label">{n}</T>}
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          );
        })}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.sm, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.border }}>
        {rest !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T variant="h2">Descanso {mmss((rest - now) / 1000)}</T>
            <Button title="Pular" kind="ghost" onPress={() => setRest(null)} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <T variant="label">
              {doneSeries}/{totalSeries} séries{startedAt !== null ? ` · ${mmss((now - startedAt) / 1000)}` : ''}
            </T>
          </View>
          <Button title="Finalizar treino" onPress={() => setFinishing(true)} disabled={doneSeries === 0} style={{ flex: 1.2 }} />
        </View>
      </View>

      <Modal visible={finishing} transparent animationType="slide" onRequestClose={() => setFinishing(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
          <View style={{ backgroundColor: c.card, padding: space.xl, gap: space.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
            <T variant="h2">Como foi o treino?</T>
            <T variant="muted">Esforço percebido (1 leve · 10 máximo)</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <Chip key={n} label={String(n)} selected={effort === n} onPress={() => setEffort(n)} />
              ))}
            </View>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Observações (opcional)"
              placeholderTextColor={c.muted}
              multiline
              style={{ minHeight: 72, borderWidth: 1.5, borderColor: c.border, borderRadius: radius.md, padding: space.md, color: c.text, fontSize: 16 }}
            />
            <Button title="Salvar treino" onPress={finish} loading={saving} />
            <Button title="Voltar" kind="ghost" onPress={() => setFinishing(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LabeledNumber({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T variant="label">{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={{ minHeight: 44, borderWidth: 1.5, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: space.md, color: c.text, fontSize: 16, backgroundColor: c.bg }}
      />
    </View>
  );
}
