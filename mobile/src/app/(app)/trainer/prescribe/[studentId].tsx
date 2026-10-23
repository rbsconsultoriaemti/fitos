import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { emptyDay, fromSuggestion, PlanEditor, toBody, type EditDay } from '@/components/plan-editor';
import { Button, Card, ErrorText, Input, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, notify } from '@/lib/dialog';
import { WEEKDAYS } from '@/lib/format';
import type { Exercise, SuggestedPlan, TrainerStudentDetail } from '@/lib/types';
import { space, useColors } from '@/theme';

type Step = 'choose' | 'suggesting' | 'edit' | 'review';

/** Prescrição de treino: escolher método (IA ou manual) -> editar -> revisar e enviar. */
export default function Prescribe() {
  const { studentId } = useLocalSearchParams<{ studentId: string }>();
  const c = useColors();
  const [name, setName] = useState('');
  const [step, setStep] = useState<Step>('choose');
  const [title, setTitle] = useState('');
  const [durationWeeks, setDurationWeeks] = useState<number | null>(null);
  const [days, setDays] = useState<EditDay[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api<TrainerStudentDetail>(`/trainer/students/${studentId}`)
      .then((d) => setName(d.student.name))
      .catch((err) => setError(errorMessage(err)));
    api<Exercise[]>('/workout/exercises')
      .then(setCatalog)
      .catch(() => undefined);
  }, [studentId]);

  const first = name.split(' ')[0] || 'o aluno';

  const startManual = () => {
    setError(null);
    setDays([emptyDay(1)]);
    setStep('edit');
  };

  const suggest = async () => {
    setError(null);
    setStep('suggesting');
    try {
      const plan = await api<SuggestedPlan>(`/trainer/students/${studentId}/suggest-plan`, { method: 'POST' });
      setTitle(plan.title);
      setDurationWeeks(plan.durationWeeks);
      setSummary(plan.summary);
      setDays(fromSuggestion(plan.days, catalog));
      setStep('edit');
    } catch (err) {
      setError(errorMessage(err));
      setStep('choose');
    }
  };

  const review = () => {
    if (title.trim().length < 2) return setError('Dê um título ao plano.');
    if (days.length === 0) return setError('Adicione ao menos um dia de treino.');
    const built = days.map(toBody);
    const bad = built.find((b): b is { error: string } => 'error' in b);
    if (bad) return setError(bad.error);
    setError(null);
    setStep('review');
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const body = {
        studentId,
        title: title.trim(),
        ...(durationWeeks ? { durationWeeks } : {}),
        days: days.map((d) => (toBody(d) as { body: object }).body),
      };
      const plan = await api<{ id: string }>('/workout/plans', { method: 'POST', body });
      await api(`/workout/plans/${plan.id}/approve`, { method: 'POST' });
      notify('Treino enviado', `O plano “${title.trim()}” já está disponível para ${first}.`);
      router.dismissTo(`/trainer/student/${studentId}` as never);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: name ? `Treino de ${first}` : 'Prescrever treino' }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl * 2, maxWidth: 640, width: '100%', alignSelf: 'center' }}
      >
        {step === 'choose' ? (
          <>
            <T variant="title">Como montar o treino?</T>
            <T variant="muted">Você revisa e edita tudo antes de enviar. Nada chega ao aluno sem a sua aprovação.</T>
            <Pressable accessibilityRole="button" onPress={suggest} disabled={!name}>
              <Card style={{ gap: space.xs, opacity: name ? 1 : 0.5 }}>
                <T variant="h2">✨ Sugerir com IA</T>
                <T variant="muted">A IA monta um rascunho com base no perfil e nas respostas do questionário de {first}.</T>
              </Card>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={startManual}>
              <Card style={{ gap: space.xs }}>
                <T variant="h2">📋 Criar manualmente</T>
                <T variant="muted">Escolha os dias e monte os exercícios a partir do catálogo.</T>
              </Card>
            </Pressable>
            <ErrorText>{error}</ErrorText>
          </>
        ) : null}

        {step === 'suggesting' ? (
          <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl * 2 }}>
            <ActivityIndicator size="large" color={c.primary} />
            <T variant="h2" style={{ textAlign: 'center' }}>
              Analisando o perfil de {name || 'o aluno'}...
            </T>
            <T variant="muted" style={{ textAlign: 'center' }}>
              Isso pode levar alguns segundos.
            </T>
          </View>
        ) : null}

        {step === 'edit' ? (
          <>
            {summary ? (
              <Card style={{ gap: space.xs }}>
                <T variant="label">Sugestão da IA — revise antes de enviar</T>
                <T variant="muted">{summary}</T>
              </Card>
            ) : null}
            <Input label="Título do plano" value={title} onChangeText={setTitle} placeholder="Ex.: Hipertrofia ABC" />
            <PlanEditor days={days} setDays={setDays} catalog={catalog} />
            <ErrorText>{error}</ErrorText>
            <Button title="Revisar e enviar" onPress={review} />
            <Button title="Voltar" kind="ghost" onPress={() => setStep('choose')} />
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <T variant="title">Revisão</T>
            <Card style={{ gap: space.sm }}>
              <T variant="h2">{title.trim()}</T>
              <T variant="muted">
                {days.length} {days.length === 1 ? 'dia' : 'dias'} por semana
                {durationWeeks ? ` · ${durationWeeks} semanas` : ''}
              </T>
              {days.map((d) => (
                <View key={d.key} style={{ gap: 2, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
                  <T variant="body" style={{ fontWeight: '700' }}>
                    {WEEKDAYS[d.dayOfWeek - 1]} · {d.muscleGroup}
                  </T>
                  {d.sets.map((s) => (
                    <T key={s.key} variant="muted">
                      {s.exercise.name} —{' '}
                      {s.exercise.category === 'cardio'
                        ? [s.duration ? `${s.duration} min` : null, s.distance ? `${s.distance} km` : null].filter(Boolean).join(' · ')
                        : `${s.sets}×${s.reps}${s.load ? ` · ${s.load} kg` : ''}`}
                    </T>
                  ))}
                </View>
              ))}
            </Card>
            <T variant="muted">Ao enviar, o plano é aprovado e passa a valer para {first}.</T>
            <ErrorText>{error}</ErrorText>
            <Button title={`Enviar para ${first}`} onPress={send} loading={sending} />
            <Button title="Voltar e editar" kind="ghost" onPress={() => setStep('edit')} disabled={sending} />
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
