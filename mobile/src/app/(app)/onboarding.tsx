import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { CatalogStatus, FoodPreferencesPicker, putFoodPreferences, savedPrefs, useFoodCatalog } from '@/components/food-preferences';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, ErrorText, Input, ProgressBar, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, notify } from '@/lib/dialog';
import { fmt0, fmt1, parseDecimal } from '@/lib/format';
import { isOffline, markPlanStale } from '@/lib/offline';
import {
  ageFromIso,
  birthToIso,
  DAYS,
  DIETS,
  emptyForm,
  FOLLOW_UPS,
  formFromProfile,
  fullPayload,
  GOALS,
  goalText,
  LAST_STEP,
  LEVELS,
  loadDraft,
  LOCATIONS,
  maskDate,
  MEALS,
  MINUTES,
  MODALITIES,
  OPTIONAL_STEPS,
  parseFavorites,
  postponeOnboarding,
  saveDraft,
  stepPayload,
  STEP_TITLES,
  validateStep,
  WATER,
  type OnboardingForm,
} from '@/lib/onboarding';
import type { Profile } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

interface PlanResult {
  planId: string;
  title: string;
  summary: string;
  days: number;
  nutritionApplied: boolean;
  nutrition: { kcal: number; proteinG: number; carbG: number; fatG: number; notes: string[] };
}

/** Marca/desmarca um item; `none` é exclusivo dos demais. */
function toggle<T extends string>(list: T[], item: T, exclusive?: T): T[] {
  if (list.includes(item)) return list.filter((i) => i !== item);
  if (exclusive && item === exclusive) return [item];
  return [...list.filter((i) => i !== exclusive), item];
}

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const c = useColors();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardingForm>(emptyForm());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  // Retoma de onde parou: o servidor é a fonte; o rascunho local cobre etapas que não chegaram a ser enviadas.
  useEffect(() => {
    (async () => {
      const draft = await loadDraft();
      let nextStep = draft?.step ?? 1;
      let nextForm = draft?.form ?? emptyForm();
      try {
        const p = await api<Profile>('/profile');
        if (!draft || p.onboarding.step >= draft.step) {
          nextStep = p.onboarding.step;
          nextForm = formFromProfile(p);
        } else if (!nextForm.name) {
          nextForm = { ...nextForm, name: p.name };
        }
      } catch {
        // sem rede: segue com o rascunho
      }
      setForm(nextForm);
      setStep(Math.min(Math.max(nextStep, 1), LAST_STEP));
      setReady(true);
    })();
  }, []);

  const set = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const goTo = useCallback((s: number) => {
    setError(null);
    setStep(s);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);

  // Botão voltar do Android: volta uma etapa (na primeira não sai; use "Preencher depois").
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (generating) return true;
      if (step > 1) goTo(step - 1);
      return true;
    });
    return () => sub.remove();
  }, [step, generating, goTo]);

  /** Guarda o progresso: sempre no aparelho, e no servidor quando houver rede (falha de rede não trava o fluxo). */
  async function persist(fromStep: number, toStep: number) {
    await saveDraft({ step: toStep, form });
    if (fromStep === 6) {
      // Offline não bloqueia: as escolhas ficam no rascunho e são reenviadas antes de gerar o plano.
      try {
        await putFoodPreferences(form.foodPrefs ?? {});
      } catch (err) {
        if (!isOffline(err)) throw err;
      }
    }
    const body = stepPayload(fromStep, form);
    try {
      const saved = await api<Profile>('/profile', { method: 'PUT', body });
      if (__DEV__) {
        // Confere se o servidor guardou tudo o que a etapa enviou.
        const sent = Object.keys((body.onboarding as { answers: object }).answers);
        const lost = sent.filter((k) => !(k in saved.onboarding.answers));
        console.log(`[onboarding] etapa ${fromStep} enviada`, JSON.stringify(body), lost.length ? `NÃO SALVOU: ${lost.join(', ')}` : 'salvo OK');
      }
    } catch (err) {
      if (!isOffline(err)) throw err;
    }
  }

  async function next(skip = false) {
    if (!skip) {
      const problem = validateStep(step, form);
      if (problem) return setError(problem);
    }
    setError(null);
    setSaving(true);
    try {
      if (skip) await saveDraft({ step: step + 1, form });
      else await persist(step, step + 1);
      if (skip && step === 6) {
        // Pular a etapa de preferências salva vazio (tudo indiferente).
        set('foodPrefs', {});
        await putFoodPreferences({}).catch(() => undefined);
      }
      if (skip) {
        // Pular não grava respostas, mas registra que a pessoa passou da etapa.
        await api('/profile', { method: 'PUT', body: { onboarding: { step: Math.min(step + 1, LAST_STEP), answers: {} } } }).catch(() => undefined);
      }
      goTo(Math.min(step + 1, LAST_STEP));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function later() {
    saveDraft({ step, form });
    postponeOnboarding();
    router.replace('/(tabs)' as never);
  }

  async function generate() {
    setError(null);
    for (let s = 1; s <= 4; s++) {
      const problem = validateStep(s, form);
      if (problem) {
        goTo(s);
        return setError(problem);
      }
    }
    setGenerating(true);
    try {
      // A IA lê as preferências do servidor: garante que a última versão chegou (só se a etapa foi respondida neste aparelho).
      if (Object.keys(form.foodPrefs ?? {}).length > 0) await putFoodPreferences(form.foodPrefs ?? {});
      // Tudo vai junto no POST (o servidor grava no perfil e só então lê): nada depende de etapas anteriores terem chegado.
      const body = fullPayload(form);
      if (__DEV__) console.log('[onboarding] POST /onboarding/complete payload:', JSON.stringify(body, null, 2));
      const res = await api<PlanResult>('/onboarding/complete', { method: 'POST', body, timeoutMs: 120_000 });
      if (__DEV__) console.log('[onboarding] resposta:', JSON.stringify({ ...res, mealPlan: '(omitido)' }));
      await saveDraft(null);
      markPlanStale();
      router.replace('/(tabs)/workout' as never);
      const n = res.nutrition;
      notify(
        'Plano criado!',
        `${res.title} · ${res.days} dias por semana.\n\n${res.nutritionApplied ? `Meta: ${fmt0(n.kcal)} kcal · P ${fmt0(n.proteinG)} g · C ${fmt0(n.carbG)} g · G ${fmt0(n.fatG)} g (veja na aba Nutrição).\n\n` : ''}${res.summary}`,
      );
    } catch (err) {
      setError(isOffline(err) ? 'Sem conexão. Conecte-se à internet para a IA criar o plano.' : errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <T variant="muted">Carregando…</T>
      </View>
    );
  }

  const optional = OPTIONAL_STEPS.includes(step);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: Platform.OS === 'web' ? space.lg : insets.top + space.md, paddingHorizontal: space.lg, gap: space.sm, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T variant="label">{`Etapa ${step} de ${LAST_STEP} · ${STEP_TITLES[step - 1]}`}</T>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={later}>
            <T variant="muted" style={{ textDecorationLine: 'underline' }}>Preencher depois</T>
          </Pressable>
        </View>
        <ProgressBar value={step / LAST_STEP} />
      </View>

      <ScrollView
        ref={scroll}
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 ? <StepPersonal form={form} set={set} /> : null}
        {step === 2 ? <StepGoal form={form} set={set} /> : null}
        {step === 3 ? <StepLevel form={form} set={set} /> : null}
        {step === 4 ? <StepRoutine form={form} set={set} /> : null}
        {step === 5 ? <StepFood form={form} set={set} /> : null}
        {step === 6 ? <StepPreferences form={form} set={set} /> : null}
        {step === 7 ? <StepHealth form={form} set={set} /> : null}
        {step === 8 ? <StepSummary form={form} onEdit={goTo} /> : null}

        <ErrorText>{error}</ErrorText>

        {step < LAST_STEP ? (
          <View style={{ gap: space.sm }}>
            <Button title="Continuar" onPress={() => next()} loading={saving} />
            {optional ? <Button title="Pular esta etapa" kind="ghost" onPress={() => next(true)} disabled={saving} /> : null}
          </View>
        ) : (
          <Button title="✨ Criar meu plano" onPress={generate} loading={generating} />
        )}
        {step > 1 ? <Button title="Voltar" kind="secondary" onPress={() => goTo(step - 1)} disabled={saving || generating} /> : null}
      </ScrollView>

      {generating ? <GeneratingOverlay /> : null}
    </KeyboardAvoidingView>
  );
}

// ---------- blocos ----------

type StepProps = { form: OnboardingForm; set: <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => void };

function Option({
  selected,
  label,
  description,
  icon,
  onPress,
}: {
  selected: boolean;
  label: string;
  description?: string;
  icon?: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}>
      <Card
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? c.primary : c.border,
        }}
      >
        {icon ? <Ionicons name={icon as never} size={28} color={selected ? c.primary : c.muted} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="h2">{label}</T>
          {description ? <T variant="muted">{description}</T> : null}
        </View>
        <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? c.primary : c.border} />
      </Card>
    </Pressable>
  );
}

function Question({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <T variant="h2">{title}</T>
      {hint ? <T variant="muted">{hint}</T> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>
    </View>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <T variant="title">{title}</T>
      <T variant="muted">{subtitle}</T>
    </View>
  );
}

// ---------- etapas ----------

function StepPersonal({ form, set }: StepProps) {
  const h = parseDecimal(form.heightCm);
  const w = parseDecimal(form.weightKg);
  const bmi = h && w && h > 0 ? w / (h / 100) ** 2 : null;
  return (
    <>
      <Heading title="Vamos nos conhecer" subtitle="Com esses dados calculamos suas metas. Você pode alterá-los depois na aba Perfil." />
      <Input label="Nome completo" value={form.name} onChangeText={(v) => set('name', v)} autoCapitalize="words" />
      <Input
        label="Data de nascimento"
        value={form.birthDate}
        onChangeText={(v) => set('birthDate', maskDate(v))}
        keyboardType="number-pad"
        placeholder="DD/MM/AAAA"
        maxLength={10}
      />
      <Question title="Sexo" hint="Usado na fórmula do gasto calórico.">
        <Chip label="Masculino" selected={form.sex === 'male'} onPress={() => set('sex', 'male')} />
        <Chip label="Feminino" selected={form.sex === 'female'} onPress={() => set('sex', 'female')} />
      </Question>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Input label="Altura (cm)" value={form.heightCm} onChangeText={(v) => set('heightCm', v)} keyboardType="decimal-pad" placeholder="178" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Peso atual (kg)" value={form.weightKg} onChangeText={(v) => set('weightKg', v)} keyboardType="decimal-pad" placeholder="82,5" />
        </View>
      </View>
      {bmi !== null && bmi > 8 && bmi < 80 ? <T variant="muted">{`IMC: ${fmt1(bmi)}`}</T> : null}
    </>
  );
}

function StepGoal({ form, set }: StepProps) {
  return (
    <>
      <Heading title="Qual é seu objetivo?" subtitle="Escolha o principal. Ele define a meta de calorias e o foco do treino." />
      {GOALS.map((g) => (
        <Option key={g.key} selected={form.goal === g.key} label={g.label} description={g.description} icon={g.icon} onPress={() => set('goal', g.key)} />
      ))}
      {form.goal === 'race' ? (
        <Question title="Qual a modalidade da prova?">
          <Chip label="Corrida" selected={form.raceType === 'running'} onPress={() => set('raceType', 'running')} />
          <Chip label="Ciclismo" selected={form.raceType === 'cycling'} onPress={() => set('raceType', 'cycling')} />
        </Question>
      ) : null}
    </>
  );
}

function StepLevel({ form, set }: StepProps) {
  return (
    <>
      <Heading title="Qual seu nível?" subtitle="Define o volume e a complexidade dos treinos." />
      {LEVELS.map((l) => (
        <Option key={l.key} selected={form.level === l.key} label={l.label} description={l.description} onPress={() => set('level', l.key)} />
      ))}
    </>
  );
}

function StepRoutine({ form, set }: StepProps) {
  return (
    <>
      <Heading title="Sua rotina de treino" subtitle="O plano será montado para caber nela." />
      <Question title="Quantos dias por semana você treina?">
        {DAYS.map((d) => (
          <Chip key={d} label={String(d)} selected={form.daysPerWeek === d} onPress={() => set('daysPerWeek', d)} />
        ))}
      </Question>
      <Question title="Quanto tempo por sessão?">
        {MINUTES.map((m) => (
          <Chip key={m.value} label={m.label} selected={form.sessionMinutes === m.value} onPress={() => set('sessionMinutes', m.value)} />
        ))}
      </Question>
      <Question title="Onde você treina?">
        {LOCATIONS.map((l) => (
          <Chip key={l.key} label={l.label} selected={form.location === l.key} onPress={() => set('location', l.key)} />
        ))}
      </Question>
      <Question title="Modalidades" hint="Pode marcar mais de uma.">
        {MODALITIES.map((m) => (
          <Chip key={m.key} label={m.label} selected={form.modalities.includes(m.key)} onPress={() => set('modalities', toggle(form.modalities, m.key))} />
        ))}
      </Question>
    </>
  );
}

function StepPreferences({ form, set }: StepProps) {
  const { catalog, loading, error, reload } = useFoodCatalog();
  const hydrated = useRef(false);

  // Traz o que já está salvo no servidor, mas não sobrescreve escolhas feitas aqui (rascunho local vence).
  useEffect(() => {
    if (catalog && !hydrated.current) {
      hydrated.current = true;
      if (Object.keys(form.foodPrefs ?? {}).length === 0) set('foodPrefs', savedPrefs(catalog));
    }
  }, [catalog, form.foodPrefs, set]);

  return (
    <>
      <Heading title="Do que você gosta?" subtitle="Etapa opcional: a IA usa suas escolhas para montar dietas melhores, e o app mostra primeiro os alimentos de que você gosta." />
      <CatalogStatus loading={loading} error={error} onRetry={reload} />
      {catalog ? <FoodPreferencesPicker catalog={catalog} value={form.foodPrefs ?? {}} onChange={(v) => set('foodPrefs', v)} /> : null}
    </>
  );
}

function StepFood({ form, set }: StepProps) {
  return (
    <>
      <Heading title="Alimentação" subtitle="Etapa opcional: ajuda a personalizar as orientações." />
      <Question title="Você tem alguma restrição alimentar?" hint="Pode marcar mais de uma.">
        {DIETS.map((d) => (
          <Chip
            key={d.key}
            label={d.label}
            selected={form.dietRestrictions.includes(d.key)}
            onPress={() => set('dietRestrictions', toggle(form.dietRestrictions, d.key, 'none'))}
          />
        ))}
      </Question>
      {form.dietRestrictions.includes('intolerance') ? (
        <Input
          label="Qual alimento?"
          value={form.intoleranceText}
          onChangeText={(v) => set('intoleranceText', v)}
          placeholder="Ex.: amendoim, frutos do mar"
          maxLength={200}
        />
      ) : null}
      <Input
        label="Quais alimentos você mais gosta? (opcional)"
        value={form.favoriteFoods}
        onChangeText={(v) => set('favoriteFoods', v)}
        placeholder="Ex.: arroz, feijão, frango grelhado, ovo cozido"
        multiline
        maxLength={300}
      />
      <Question title="Quantas refeições por dia?">
        {MEALS.map((m) => (
          <Chip key={m} label={m === 6 ? '6 ou mais' : String(m)} selected={form.mealsPerDay === m} onPress={() => set('mealsPerDay', m)} />
        ))}
      </Question>
      <Question title="Você bebe água suficiente?">
        {WATER.map((w) => (
          <Chip key={w.key} label={w.label} selected={form.water === w.key} onPress={() => set('water', w.key)} />
        ))}
      </Question>
    </>
  );
}

function StepHealth({ form, set }: StepProps) {
  return (
    <>
      <Heading title="Saúde" subtitle="Etapa opcional. Usamos para evitar exercícios que agravem uma lesão." />
      <Input
        label="Tem alguma lesão ou limitação física?"
        value={form.injuries}
        onChangeText={(v) => set('injuries', v)}
        placeholder="Ex.: dor no joelho direito, hérnia de disco"
        multiline
        maxLength={500}
        style={{ minHeight: 90, textAlignVertical: 'top' }}
      />
      <Question title="Faz acompanhamento com profissional?" hint="Pode marcar mais de uma.">
        {FOLLOW_UPS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            selected={form.followUp.includes(f.key)}
            onPress={() => set('followUp', toggle(form.followUp, f.key, 'none'))}
          />
        ))}
      </Question>
    </>
  );
}

function StepSummary({ form, onEdit }: { form: OnboardingForm; onEdit: (step: number) => void }) {
  const iso = birthToIso(form.birthDate);
  const h = parseDecimal(form.heightCm);
  const w = parseDecimal(form.weightKg);
  const bmi = h && w && h > 0 ? w / (h / 100) ** 2 : null;
  const bmiLabel = bmi === null ? '' : bmi < 18.5 ? 'abaixo do peso' : bmi < 25 ? 'peso adequado' : bmi < 30 ? 'sobrepeso' : 'obesidade';
  const label = <K extends { key: string; label: string }>(list: K[], key: string | null) => list.find((i) => i.key === key)?.label;
  const diets = form.dietRestrictions.length ? form.dietRestrictions.map((d) => label(DIETS, d)).join(', ') : 'Não informado';
  const follow = form.followUp.length ? form.followUp.map((f) => label(FOLLOW_UPS, f)).join(', ') : 'Não informado';

  const sections: { step: number; title: string; rows: [string, string][] }[] = [
    {
      step: 1,
      title: 'Dados pessoais',
      rows: [
        ['Nome', form.name.trim()],
        ['Idade', iso ? `${ageFromIso(iso)} anos · ${form.sex === 'male' ? 'masculino' : 'feminino'}` : '—'],
        ['Altura e peso', h && w ? `${fmt0(h)} cm · ${fmt1(w)} kg` : '—'],
        ['IMC', bmi !== null ? `${fmt1(bmi)} (${bmiLabel})` : '—'],
      ],
    },
    { step: 2, title: 'Objetivo', rows: [['Objetivo', goalText(form) ?? '—']] },
    { step: 3, title: 'Experiência', rows: [['Nível', LEVELS.find((l) => l.key === form.level)?.label ?? '—']] },
    {
      step: 4,
      title: 'Rotina de treino',
      rows: [
        ['Frequência', `${form.daysPerWeek ?? '—'} dias por semana · ${MINUTES.find((m) => m.value === form.sessionMinutes)?.label ?? '—'} por sessão`],
        ['Local', label(LOCATIONS, form.location) ?? '—'],
        ['Modalidades', form.modalities.map((m) => label(MODALITIES, m)).join(', ') || '—'],
      ],
    },
    {
      step: 5,
      title: 'Alimentação',
      rows: [
        ['Restrições', form.dietRestrictions.includes('intolerance') && form.intoleranceText.trim() ? `${diets} (${form.intoleranceText.trim()})` : diets],
        ['Refeições por dia', form.mealsPerDay ? (form.mealsPerDay === 6 ? '6 ou mais' : String(form.mealsPerDay)) : 'Não informado'],
        ['Água', label(WATER, form.water) ?? 'Não informado'],
        ['Alimentos favoritos', parseFavorites(form.favoriteFoods).join(', ') || 'Não informado'],
      ],
    },
    {
      step: 6,
      title: 'Preferências alimentares',
      rows: [
        ['Gosto', `${Object.values(form.foodPrefs ?? {}).filter((s) => s === 'like').length} alimentos`],
        ['Não gosto', `${Object.values(form.foodPrefs ?? {}).filter((s) => s === 'dislike').length} alimentos`],
      ],
    },
    {
      step: 7,
      title: 'Saúde',
      rows: [
        ['Lesões ou limitações', form.injuries.trim() || 'Nenhuma informada'],
        ['Acompanhamento', follow],
      ],
    },
  ];

  return (
    <>
      <Heading title="Tudo certo?" subtitle="Confira o resumo. Toque em Editar para ajustar qualquer etapa." />
      {sections.map((s) => (
        <Card key={s.step} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T variant="h2">{s.title}</T>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onEdit(s.step)}>
              <T variant="label" style={{ textDecorationLine: 'underline' }}>Editar</T>
            </Pressable>
          </View>
          {s.rows.map(([k, v]) => (
            <View key={k}>
              <T variant="muted">{k}</T>
              <T>{v}</T>
            </View>
          ))}
        </Card>
      ))}
      <Card style={{ gap: space.xs }}>
        <T variant="h2">O que a IA vai criar</T>
        <T variant="muted">
          • Plano de treino semanal conforme seus dias, tempo, local e modalidades{'\n'}• Meta de calorias calculada pelo seu IMC e objetivo{'\n'}• Sugestão de
          proteína, carboidrato e gordura{'\n'}• Plano alimentar de um dia, com seus alimentos favoritos
        </T>
        <T variant="muted">São sugestões automáticas e não substituem a orientação de um profissional de saúde.</T>
      </Card>
    </>
  );
}

// ---------- carregando ----------

const MESSAGES = [
  'Analisando seu perfil…',
  'Escolhendo os exercícios ideais…',
  'Montando sua semana de treino…',
  'Calculando suas calorias e macros…',
  'Ajustando os últimos detalhes…',
];

function GeneratingOverlay() {
  const c = useColors();
  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const [i, setI] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const rotate = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    rotate.start();
    const timer = setInterval(() => setI((n) => Math.min(n + 1, MESSAGES.length - 1)), 4000);
    return () => {
      loop.stop();
      rotate.stop();
      clearInterval(timer);
    };
  }, [pulse, spin]);

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: c.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.xl,
        padding: space.xl,
      }}
    >
      <Animated.View
        style={{
          width: 120,
          height: 120,
          borderRadius: radius.lg * 4,
          backgroundColor: c.card,
          borderWidth: 2,
          borderColor: c.primary,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
          transform: [
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) },
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        }}
      >
        <Ionicons name="sparkles" size={52} color={c.primary} />
      </Animated.View>
      <View style={{ gap: space.sm, alignItems: 'center' }}>
        <T variant="h2">Criando seu plano</T>
        <T variant="muted" style={{ textAlign: 'center' }}>{MESSAGES[i]}</T>
        <T variant="muted" style={{ textAlign: 'center' }}>Isso leva cerca de 30 segundos. Não feche o app.</T>
      </View>
    </View>
  );
}
