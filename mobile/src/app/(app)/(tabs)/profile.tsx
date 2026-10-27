import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { Button, Card, Chip, ErrorText, Input, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, notify } from '@/lib/dialog';
import { fmt1, parseDecimal } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { space } from '@/theme';

const SEXES = [
  { value: 'male', label: 'Masculino' },
  { value: 'female', label: 'Feminino' },
  { value: 'other', label: 'Outro' },
] as const;

const LEVELS = [
  { value: 'beginner', label: 'Iniciante' },
  { value: 'intermediate', label: 'Intermediário' },
  { value: 'advanced', label: 'Avançado' },
] as const;

interface Form {
  name: string;
  birthDate: string; // DD/MM/AAAA
  sex: Profile['sex'];
  heightCm: string;
  weightKg: string;
  bodyFatPct: string;
  restingHrBpm: string;
  maxHrBpm: string;
  goal: string;
  fitnessLevel: Profile['fitnessLevel'];
  restrictions: string; // separadas por vírgula
}

const show = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

function toForm(p: Profile): Form {
  const [y, m, d] = p.birthDate ? p.birthDate.split('-') : ['', '', ''];
  return {
    name: p.name,
    birthDate: p.birthDate ? `${d}/${m}/${y}` : '',
    sex: p.sex,
    heightCm: show(p.heightCm),
    weightKg: show(p.weightKg),
    bodyFatPct: show(p.bodyFatPct),
    restingHrBpm: show(p.restingHrBpm),
    maxHrBpm: show(p.maxHrBpm),
    goal: p.goal ?? '',
    fitnessLevel: p.fitnessLevel,
    restrictions: p.restrictions.join(', '),
  };
}

/** Texto vazio vira null (apaga o campo); inválido lança erro com o nome do campo. */
function numberOrNull(text: string, label: string): number | null {
  if (text.trim() === '') return null;
  const n = parseDecimal(text);
  if (n === null) throw new Error(`${label}: informe um número`);
  return n;
}

function birthToIso(text: string): string | null {
  if (text.trim() === '') return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) throw new Error('Data de nascimento: use DD/MM/AAAA');
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function ageOf(iso: string | null): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

export default function ProfileScreen() {
  const [form, setForm] = useState<Form | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api<Profile>('/profile');
      setForm(toForm(p));
      setEmail(p.email);
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

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  async function save() {
    if (!form) return;
    setError(null);
    let body;
    try {
      body = {
        name: form.name.trim(),
        birthDate: birthToIso(form.birthDate),
        sex: form.sex,
        heightCm: numberOrNull(form.heightCm, 'Altura'),
        weightKg: numberOrNull(form.weightKg, 'Peso'),
        bodyFatPct: numberOrNull(form.bodyFatPct, '% de gordura'),
        restingHrBpm: numberOrNull(form.restingHrBpm, 'FC de repouso'),
        maxHrBpm: numberOrNull(form.maxHrBpm, 'FC máxima'),
        goal: form.goal.trim() || null,
        fitnessLevel: form.fitnessLevel,
        restrictions: form.restrictions
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
      };
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    setSaving(true);
    try {
      const p = await api<Profile>('/profile', { method: 'PUT', body });
      setForm(toForm(p));
      notify('Salvo', 'Seus dados foram atualizados.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <View style={{ padding: space.lg, gap: space.md }}>
        <ErrorText>{error}</ErrorText>
        {error ? <Button title="Tentar novamente" kind="secondary" onPress={load} /> : <T variant="muted">Carregando…</T>}
      </View>
    );
  }

  const height = parseDecimal(form.heightCm);
  const weight = parseDecimal(form.weightKg);
  const bmi = height && weight && height > 0 ? weight / (height / 100) ** 2 : null;
  let iso: string | null = null;
  try {
    iso = birthToIso(form.birthDate);
  } catch {
    iso = null;
  }
  const age = ageOf(iso);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <ErrorText>{error}</ErrorText>

        <Card style={{ gap: space.md }}>
          <T variant="h2">Dados pessoais</T>
          <Input label="Nome" value={form.name} onChangeText={(v) => set('name', v)} />
          <Input label="E-mail" value={email} editable={false} />
          <Input
            label="Data de nascimento (DD/MM/AAAA)"
            value={form.birthDate}
            onChangeText={(v) => set('birthDate', v)}
            keyboardType="numbers-and-punctuation"
            placeholder="12/05/1990"
          />
          {age !== null ? <T variant="muted">{`${age} anos`}</T> : null}
          <T variant="label">Sexo</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {SEXES.map((s) => (
              <Chip key={s.value} label={s.label} selected={form.sex === s.value} onPress={() => set('sex', form.sex === s.value ? null : s.value)} />
            ))}
          </View>
        </Card>

        <Card style={{ gap: space.md }}>
          <T variant="h2">Medidas</T>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Input label="Altura (cm)" value={form.heightCm} onChangeText={(v) => set('heightCm', v)} keyboardType="decimal-pad" placeholder="178" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Peso (kg)" value={form.weightKg} onChangeText={(v) => set('weightKg', v)} keyboardType="decimal-pad" placeholder="82,5" />
            </View>
          </View>
          {bmi !== null ? <T variant="muted">{`IMC: ${fmt1(bmi)}`}</T> : null}
          <Input
            label="Gordura corporal (%)"
            value={form.bodyFatPct}
            onChangeText={(v) => set('bodyFatPct', v)}
            keyboardType="decimal-pad"
            placeholder="opcional"
          />
        </Card>

        <Card style={{ gap: space.md }}>
          <T variant="h2">Frequência cardíaca</T>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Input label="Repouso (bpm)" value={form.restingHrBpm} onChangeText={(v) => set('restingHrBpm', v)} keyboardType="number-pad" placeholder="58" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Máxima (bpm)" value={form.maxHrBpm} onChangeText={(v) => set('maxHrBpm', v)} keyboardType="number-pad" placeholder="188" />
            </View>
          </View>
          {age !== null && form.maxHrBpm.trim() === '' ? (
            <T variant="muted">{`Estimativa pela idade (220 − idade): ${220 - age} bpm. Se você já mediu a sua, informe acima.`}</T>
          ) : null}
        </Card>

        <Card style={{ gap: space.md }}>
          <T variant="h2">Objetivo e saúde</T>
          <Input label="Objetivo" value={form.goal} onChangeText={(v) => set('goal', v)} placeholder="Ex.: hipertrofia, meia maratona" multiline />
          <T variant="label">Nível</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {LEVELS.map((l) => (
              <Chip
                key={l.value}
                label={l.label}
                selected={form.fitnessLevel === l.value}
                onPress={() => set('fitnessLevel', form.fitnessLevel === l.value ? null : l.value)}
              />
            ))}
          </View>
          <Input
            label="Lesões e restrições (separe por vírgula)"
            value={form.restrictions}
            onChangeText={(v) => set('restrictions', v)}
            placeholder="Ex.: joelho direito, hérnia de disco"
            multiline
          />
        </Card>

        <T variant="muted">Estes dados são sensíveis e ficam visíveis só para você.</T>
        <Button title="Salvar" onPress={save} loading={saving} />
        <T variant="h2">Alimentação</T>
        <Button title="Minhas preferências" kind="secondary" onPress={() => router.push('/settings/food-preferences' as never)} />
        <Button title="Alimentos favoritos" kind="secondary" onPress={() => router.push('/settings/favorite-foods' as never)} />
        <Button title="Refeições favoritas" kind="secondary" onPress={() => router.push('/favorites' as never)} />
        <Button title="Notificações e lembretes" kind="secondary" onPress={() => router.push('/settings/notifications' as never)} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
