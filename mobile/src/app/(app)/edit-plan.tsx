import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { fromPlan, PlanEditor, toBody, type EditDay } from '@/components/plan-editor';
import { Button, ErrorText, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, notify } from '@/lib/dialog';
import { isOffline, loadActivePlan, markPlanStale } from '@/lib/offline';
import type { Exercise, WorkoutPlan } from '@/lib/types';
import { space, useColors } from '@/theme';

export default function EditPlan() {
  const c = useColors();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [days, setDays] = useState<EditDay[]>([]);
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { plan: p, offline } = await loadActivePlan();
        if (offline) return setError('Sem conexão. Para editar o plano é preciso estar online — o treino salvo no aparelho continua funcionando.');
        if (!p) return setError('Você ainda não tem um plano ativo.');
        if (p.source === 'trainer') return setError('Este plano foi prescrito pelo seu profissional. Peça a ele para editar.');
        const d = fromPlan(p);
        setPlan(p);
        setDays(d);
        setCatalog(await api<Exercise[]>('/workout/exercises'));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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


  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120, maxWidth: 640, width: '100%', alignSelf: 'center' }}
      >
        <T variant="muted">{plan.title}</T>
        <PlanEditor days={days} setDays={setDays} catalog={catalog} />
        <ErrorText>{error}</ErrorText>
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.border }}>
        <Button title="Salvar alterações" onPress={save} loading={saving} />
      </View>

    </View>
  );
}
