import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, View } from 'react-native';

import { Button, Card, ErrorText, Input, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { fmt0, parseDecimal } from '@/lib/format';
import { isOffline } from '@/lib/offline';
import type { DayLog } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

const SOURCE_LABEL = { override: 'definida por você', plan: 'do seu plano alimentar', dynamic: 'calculada' } as const;
const MISSING_LABEL: Record<string, string> = { weight: 'peso', height: 'altura', birthDate: 'data de nascimento', sex: 'sexo' };

const fmtFactor = (n: number) => n.toFixed(2).replace('.', ',');

/** Meta de calorias do dia (calculada pelo perfil e treinos; o usuário pode sobrescrever) e como ela foi calculada. */
export function EnergyCard({ day, onChanged }: { day: DayLog; onChanged: () => void }) {
  const c = useColors();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const energy = day.energy;
  const target = day.targets?.kcal ?? null;
  const source = day.targets?.kcalSource ?? null;
  const b = energy?.breakdown;

  async function save(overrideKcal: number | null) {
    setSaving(true);
    setError(null);
    try {
      await api('/nutrition/energy-target', { method: 'PUT', body: { overrideKcal } });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(isOffline(err) ? 'Ajustar a meta exige internet.' : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    const n = parseDecimal(text);
    if (n === null || !Number.isInteger(n) || n < 800 || n > 10000) {
      setError('Informe um número inteiro entre 800 e 10000.');
      return;
    }
    save(n);
  }

  return (
    <Card style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T variant="label">Meta de hoje</T>
        <Button
          title="Ajustar"
          kind="ghost"
          onPress={() => {
            setText(String(day.energy?.overrideKcal ?? target ?? ''));
            setError(null);
            setEditing(true);
          }}
        />
      </View>

      {target !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <T variant="number">{fmt0(target)}</T>
          <T variant="muted">{`kcal${source ? ` · ${SOURCE_LABEL[source]}` : ''}`}</T>
        </View>
      ) : (
        <T variant="muted">Sem meta de calorias definida.</T>
      )}

      {b ? (
        <View style={{ gap: 2 }}>
          <T variant="body" style={{ fontWeight: '600' }}>
            {b.exerciseKcal > 0
              ? `Meta base: ${fmt0(b.baseKcal)} kcal + Treino: +${fmt0(b.exerciseKcal)} kcal = ${fmt0(b.dynamicKcal)} kcal`
              : `Meta base: ${fmt0(b.baseKcal)} kcal · dia sem treino registrado`}
          </T>
          <T variant="muted">
            {`Metabolismo basal ${fmt0(b.bmr)} × 1,2` +
              (b.exerciseKcal > 0 ? ` · ${b.trainingMinutes} min de treino (fator ${fmtFactor(b.activityFactor)})` : ' · a meta sobe quando você registrar um treino')}
          </T>
          {source && source !== 'dynamic' ? <T variant="muted">{`A meta exibida acima é ${SOURCE_LABEL[source]}; o cálculo do perfil seria ${fmt0(b.dynamicKcal)} kcal.`}</T> : null}
        </View>
      ) : energy && energy.missing.length > 0 ? (
        <>
          <T variant="muted">{`Para calcular sua meta, preencha no Perfil: ${energy.missing.map((m) => MISSING_LABEL[m] ?? m).join(', ')}.`}</T>
          <Button title="Abrir Perfil" kind="secondary" onPress={() => router.navigate('/profile')} />
        </>
      ) : null}

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: space.lg }}
        >
          <View style={{ backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
            <T variant="h2">Meta de calorias</T>
            <T variant="muted">Defina a sua meta diária. Ela substitui a calculada e a do plano alimentar.</T>
            <Input label="kcal por dia" value={text} onChangeText={setText} keyboardType="number-pad" autoFocus selectTextOnFocus />
            <ErrorText>{error}</ErrorText>
            <Button title="Salvar minha meta" onPress={submit} loading={saving} />
            {energy?.overrideKcal != null ? (
              <Button title="Voltar para a meta automática" kind="secondary" onPress={() => save(null)} disabled={saving} />
            ) : null}
            <Button title="Cancelar" kind="ghost" onPress={() => setEditing(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Card>
  );
}
