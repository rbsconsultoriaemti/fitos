import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { Button, Card, Chip, ErrorText, Input, T } from '@/components/ui';
import { api } from '@/lib/api';
import { confirm, errorMessage, notify } from '@/lib/dialog';
import { parseDecimal, WEEKDAYS } from '@/lib/format';
import { isOffline, loadActivePlan, markPlanStale } from '@/lib/offline';
import type { Exercise, WorkoutPlan } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

// Estado de edição: tudo como texto (campos de formulário); convertido só ao salvar.
interface EditSet {
  key: string;
  id?: string; // série existente; ao trocar o exercício o backend arquiva a antiga e cria a nova
  exercise: { id: string; name: string; category: string };
  sets: string;
  reps: string;
  load: string;
  rest: string;
  duration: string;
  distance: string;
}

interface EditDay {
  key: string;
  dayOfWeek: number;
  muscleGroup: string;
  notes: string;
  sets: EditSet[];
}

let counter = 0;
const nextKey = () => `k${++counter}`;
const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const isCardio = (s: EditSet) => s.exercise.category === 'cardio';

function fromPlan(plan: WorkoutPlan): EditDay[] {
  return plan.days.map((d) => ({
    key: nextKey(),
    dayOfWeek: d.dayOfWeek,
    muscleGroup: d.muscleGroup,
    notes: d.notes ?? '',
    sets: d.sets.map((s) => ({
      key: nextKey(),
      id: s.id,
      exercise: { id: s.exercise.id, name: s.exercise.name, category: s.exercise.category },
      sets: text(s.sets),
      reps: s.reps ?? '',
      load: text(s.loadKg),
      rest: text(s.restSeconds),
      duration: text(s.durationMin),
      distance: text(s.distanceKm),
    })),
  }));
}

/** Valida e converte um dia para o corpo do PUT; devolve a mensagem de erro se algo estiver inválido. */
function toBody(day: EditDay): { error: string } | { body: object } {
  if (day.muscleGroup.trim().length < 2) return { error: `${WEEKDAYS[day.dayOfWeek - 1]}: dê um nome ao treino (ex.: Superiores).` };
  if (day.sets.length === 0) return { error: `${WEEKDAYS[day.dayOfWeek - 1]}: adicione ao menos um exercício ou remova o dia.` };
  const sets = [];
  for (const s of day.sets) {
    const where = `${WEEKDAYS[day.dayOfWeek - 1]} · ${s.exercise.name}`;
    const rest = parseDecimal(s.rest);
    const restSeconds = rest !== null ? { restSeconds: Math.round(rest) } : {};
    if (isCardio(s)) {
      const minutes = parseDecimal(s.duration);
      const km = parseDecimal(s.distance);
      if ((minutes === null || minutes < 1) && (km === null || km <= 0)) return { error: `${where}: informe o tempo (min) ou a distância (km).` };
      sets.push({
        ...(s.id ? { id: s.id } : {}),
        exerciseId: s.exercise.id,
        sets: 1,
        ...(minutes !== null && minutes >= 1 ? { durationMin: Math.round(minutes) } : {}),
        ...(km !== null && km > 0 ? { distanceKm: km } : {}),
        ...restSeconds,
      });
    } else {
      const n = parseDecimal(s.sets);
      if (n === null || n < 1 || n > 20) return { error: `${where}: séries deve ser de 1 a 20.` };
      if (!/^\d+(-\d+)?$/.test(s.reps.trim())) return { error: `${where}: reps deve ser "10" ou uma faixa como "8-12".` };
      const load = parseDecimal(s.load);
      sets.push({
        ...(s.id ? { id: s.id } : {}),
        exerciseId: s.exercise.id,
        sets: Math.round(n),
        reps: s.reps.trim(),
        ...(load !== null && load >= 0 ? { loadKg: load } : {}),
        ...restSeconds,
      });
    }
  }
  return {
    body: { dayOfWeek: day.dayOfWeek, muscleGroup: day.muscleGroup.trim(), ...(day.notes.trim() ? { notes: day.notes.trim() } : {}), sets },
  };
}

export default function EditPlan() {
  const c = useColors();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [days, setDays] = useState<EditDay[]>([]);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [picker, setPicker] = useState<{ replaceKey: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { plan: p, offline } = await loadActivePlan();
        if (offline) return setError('Sem conexão. Para editar o plano é preciso estar online — o treino salvo no aparelho continua funcionando.');
        if (!p) return setError('Você ainda não tem um plano ativo.');
        if (p.source !== 'self') return setError('Este plano foi prescrito pelo seu profissional. Peça a ele para editar.');
        const d = fromPlan(p);
        setPlan(p);
        setDays(d);
        setDayKey(d[0]?.key ?? null);
        setCatalog(await api<Exercise[]>('/workout/exercises'));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const day = days.find((d) => d.key === dayKey) ?? null;
  const patchDay = (key: string, p: Partial<EditDay>) => setDays((cur) => cur.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const patchSet = (daykey: string, setKey: string, p: Partial<EditSet>) =>
    setDays((cur) => cur.map((d) => (d.key === daykey ? { ...d, sets: d.sets.map((s) => (s.key === setKey ? { ...s, ...p } : s)) } : d)));

  const move = (setKey: string, dir: -1 | 1) => {
    if (!day) return;
    const i = day.sets.findIndex((s) => s.key === setKey);
    const j = i + dir;
    if (j < 0 || j >= day.sets.length) return;
    const sets = [...day.sets];
    [sets[i], sets[j]] = [sets[j], sets[i]];
    patchDay(day.key, { sets });
  };

  const pick = (e: Exercise) => {
    if (!day || !picker) return;
    const ex = { id: e.id, name: e.name, category: e.category };
    if (picker.replaceKey) {
      // Troca: mantém o id da série (o backend arquiva a antiga) e reaproveita séries/descanso.
      const old = day.sets.find((x) => x.key === picker.replaceKey);
      const changesKind = old !== undefined && isCardio(old) !== (e.category === 'cardio');
      patchSet(day.key, picker.replaceKey, {
        exercise: ex,
        // Só reinicia os campos quando troca de força para cardio (ou vice-versa).
        ...(changesKind ? (e.category === 'cardio' ? { duration: '30', distance: '', reps: '', sets: '1', load: '', rest: '' } : { reps: '10', sets: '3', rest: '60', duration: '', distance: '' }) : {}),
      });
    } else {
      const cardio = e.category === 'cardio';
      patchDay(day.key, {
        sets: [
          ...day.sets,
          { key: nextKey(), exercise: ex, sets: cardio ? '1' : '3', reps: cardio ? '' : '10', load: '', rest: cardio ? '' : '60', duration: cardio ? '30' : '', distance: '' },
        ],
      });
    }
    setPicker(null);
  };

  const addDay = (dayOfWeek: number) => {
    const d: EditDay = { key: nextKey(), dayOfWeek, muscleGroup: '', notes: '', sets: [] };
    setDays((cur) => [...cur, d].sort((a, b) => a.dayOfWeek - b.dayOfWeek));
    setDayKey(d.key);
  };

  const removeDay = async () => {
    if (!day) return;
    if (!(await confirm('Remover dia', `Remover o treino de ${WEEKDAYS[day.dayOfWeek - 1]}? Vale ao salvar.`, 'Remover'))) return;
    const rest = days.filter((d) => d.key !== day.key);
    setDays(rest);
    setDayKey(rest[0]?.key ?? null);
  };

  const save = async () => {
    if (!plan) return;
    if (days.length === 0) return setError('O plano precisa ter ao menos um dia.');
    const built = days.map(toBody);
    const bad = built.find((b): b is { error: string } => 'error' in b);
    if (bad) return setError(bad.error);
    setError(null);
    setSaving(true);
    try {
      await api(`/workout/plans/${plan.id}`, {
        method: 'PUT',
        body: { title: plan.title, durationWeeks: plan.durationWeeks ?? undefined, days: built.map((b) => (b as { body: object }).body) },
      });
      await loadActivePlan(); // atualiza a cópia salva no aparelho (treino offline)
      markPlanStale();
      notify('Plano atualizado', 'As alterações já valem para o próximo treino.');
      router.back();
    } catch (err) {
      setError(isOffline(err) ? 'Sem conexão. Tente novamente quando houver sinal.' : errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={{ padding: space.lg }}><T variant="muted">Carregando…</T></View>;
  if (!plan) return <View style={{ padding: space.lg, gap: space.md }}><ErrorText>{error}</ErrorText><Button title="Voltar" kind="secondary" onPress={() => router.back()} /></View>;

  const freeDays = [1, 2, 3, 4, 5, 6, 7].filter((n) => !days.some((d) => d.dayOfWeek === n));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120, maxWidth: 640, width: '100%', alignSelf: 'center' }}
      >
        <T variant="muted">{plan.title}</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {days.map((d) => (
            <Chip key={d.key} label={`${WEEKDAYS[d.dayOfWeek - 1]} · ${d.muscleGroup || 'novo'}`} selected={d.key === dayKey} onPress={() => setDayKey(d.key)} />
          ))}
        </ScrollView>

        {freeDays.length > 0 ? (
          <View style={{ gap: space.xs }}>
            <T variant="label">Adicionar dia de treino</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
              {freeDays.map((n) => (
                <Chip key={n} label={`+ ${WEEKDAYS[n - 1]}`} onPress={() => addDay(n)} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {day ? (
          <>
            <Input label="Nome do treino" value={day.muscleGroup} onChangeText={(v) => patchDay(day.key, { muscleGroup: v })} placeholder="Ex.: Superiores, Corrida longa" />

            {day.sets.map((s, i) => (
              <Card key={s.key}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <T variant="h2" style={{ flex: 1 }}>
                    {s.exercise.name}
                  </T>
                  <IconButton name="chevron-up" disabled={i === 0} onPress={() => move(s.key, -1)} label="Subir" />
                  <IconButton name="chevron-down" disabled={i === day.sets.length - 1} onPress={() => move(s.key, 1)} label="Descer" />
                </View>

                {isCardio(s) ? (
                  <View style={{ flexDirection: 'row', gap: space.md }}>
                    <Field label="Tempo (min)" value={s.duration} onChange={(v) => patchSet(day.key, s.key, { duration: v })} />
                    <Field label="Distância (km)" value={s.distance} onChange={(v) => patchSet(day.key, s.key, { distance: v })} />
                  </View>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', gap: space.md }}>
                      <Field label="Séries" value={s.sets} onChange={(v) => patchSet(day.key, s.key, { sets: v })} />
                      <Field label="Reps (ex.: 8-12)" value={s.reps} onChange={(v) => patchSet(day.key, s.key, { reps: v })} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: space.md }}>
                      <Field label="Carga (kg)" value={s.load} onChange={(v) => patchSet(day.key, s.key, { load: v })} />
                      <Field label="Descanso (s)" value={s.rest} onChange={(v) => patchSet(day.key, s.key, { rest: v })} />
                    </View>
                  </>
                )}

                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button title="Trocar" kind="secondary" style={{ flex: 1 }} onPress={() => setPicker({ replaceKey: s.key })} />
                  <Button
                    title="Remover"
                    kind="ghost"
                    style={{ flex: 1 }}
                    onPress={() => patchDay(day.key, { sets: day.sets.filter((x) => x.key !== s.key) })}
                  />
                </View>
              </Card>
            ))}

            <Button title="+ Adicionar exercício" kind="secondary" onPress={() => setPicker({ replaceKey: null })} />
            <Button title="Remover este dia" kind="ghost" onPress={removeDay} />
          </>
        ) : (
          <T variant="muted">Nenhum dia no plano. Adicione um dia acima.</T>
        )}
        <ErrorText>{error}</ErrorText>
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.border }}>
        <Button title="Salvar alterações" onPress={save} loading={saving} />
      </View>

      <ExercisePicker visible={picker !== null} catalog={catalog} onClose={() => setPicker(null)} onPick={pick} />
    </View>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T variant="label">{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numbers-and-punctuation"
        selectTextOnFocus
        style={{ minHeight: 44, borderWidth: 1.5, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: space.md, color: c.text, fontSize: 16, backgroundColor: c.bg }}
      />
    </View>
  );
}

function IconButton({ name, onPress, disabled, label }: { name: 'chevron-up' | 'chevron-down'; onPress: () => void; disabled?: boolean; label: string }) {
  const c = useColors();
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={6} style={{ opacity: disabled ? 0.3 : 1, padding: 4 }}>
      <Ionicons name={name} size={24} color={c.text as string} />
    </Pressable>
  );
}

function ExercisePicker({ visible, catalog, onClose, onPick }: { visible: boolean; catalog: Exercise[]; onClose: () => void; onPick: (e: Exercise) => void }) {
  const c = useColors();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const groups = useMemo(() => [...new Set(catalog.map((e) => e.muscleGroup))], [catalog]);
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = catalog.filter((e) => (!group || e.muscleGroup === group) && norm(e.name).includes(norm(q.trim())));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ padding: space.lg, paddingTop: space.xl * 1.5, gap: space.md, flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T variant="h2">Escolher exercício</T>
            <Button title="Fechar" kind="ghost" onPress={onClose} />
          </View>
          <Input placeholder="Buscar (ex.: supino, corrida, bike)" value={q} onChangeText={setQ} autoCorrect={false} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} style={{ flexGrow: 0 }}>
            <Chip label="Todos" selected={group === null} onPress={() => setGroup(null)} />
            {groups.map((g) => (
              <Chip key={g} label={g} selected={group === g} onPress={() => setGroup(g)} />
            ))}
          </ScrollView>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm, paddingBottom: space.xl }}>
            {list.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => {
                  setQ('');
                  setGroup(null);
                  onPick(e);
                }}
                style={{ padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}
              >
                <T variant="body" style={{ fontWeight: '700' }}>
                  {e.name}
                </T>
                <T variant="muted">{[e.muscleGroup, e.equipment].filter(Boolean).join(' · ')}</T>
              </Pressable>
            ))}
            {list.length === 0 ? <T variant="muted">Nenhum exercício encontrado.</T> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
