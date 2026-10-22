import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Button, Card, T } from '@/components/ui';
import { notify } from '@/lib/dialog';
import {
  DEFAULT_PREFS,
  getPermissionState,
  loadPrefs,
  MEAL_REMINDERS,
  requestPermission,
  rescheduleAll,
  savePrefs,
  sendTestNotification,
  WATER_HOURS,
  type NotificationPrefs,
  type PermissionState,
} from '@/lib/notifications';
import { radius, space, useColors } from '@/theme';

const pad = (n: number) => String(n).padStart(2, '0');

/** Seletor de hora sem módulo nativo: botões − / + para hora e minuto (de 5 em 5). */
function TimeStepper({ hour, minute, onChange, disabled }: { hour: number; minute: number; onChange: (h: number, m: number) => void; disabled?: boolean }) {
  const c = useColors();
  const step = (label: string, onPress: () => void, hint: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  const addMinutes = (delta: number) => {
    const total = (((hour * 60 + minute + delta) % 1440) + 1440) % 1440;
    onChange(Math.floor(total / 60), total % 60);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        {step('+', () => addMinutes(60), 'Uma hora a mais')}
        {step('−', () => addMinutes(-60), 'Uma hora a menos')}
      </View>
      <Text accessibilityLabel={`Horário ${pad(hour)} e ${pad(minute)}`} style={{ color: c.text, fontSize: 34, fontWeight: '800', minWidth: 104, textAlign: 'center' }}>
        {`${pad(hour)}:${pad(minute)}`}
      </Text>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        {step('+', () => addMinutes(5), '5 minutos a mais')}
        {step('−', () => addMinutes(-5), '5 minutos a menos')}
      </View>
    </View>
  );
}

function Row({ title, hint, value, onValueChange, disabled }: { title: string; hint: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="h2">{title}</T>
        <T variant="muted">{hint}</T>
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: c.primary, false: c.border }} accessibilityLabel={title} />
    </View>
  );
}

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [scheduled, setScheduled] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setPrefs(await loadPrefs());
    setPermission(await getPermissionState());
    setScheduled(await rescheduleAll());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function update(next: NotificationPrefs) {
    setPrefs(next);
    await savePrefs(next);
    setScheduled(await rescheduleAll());
  }

  async function allow() {
    setPermission(await requestPermission());
    setScheduled(await rescheduleAll());
  }

  async function test() {
    const ok = await sendTestNotification();
    notify(ok ? 'Teste enviado' : 'Não foi possível', ok ? 'Em 5 segundos chega uma notificação. Pode sair do app para ver.' : 'Permita as notificações para testar.');
  }

  const blocked = permission !== 'granted';

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      {permission === 'unavailable' ? (
        <Card style={{ gap: space.sm }}>
          <T variant="h2">Notificações indisponíveis</T>
          <T variant="muted">Este aparelho ou esta versão do app não suporta lembretes. Instale a versão mais recente do FitOS.</T>
        </Card>
      ) : blocked ? (
        <Card style={{ gap: space.sm }}>
          <T variant="h2">Ative as notificações</T>
          <T variant="muted">Sem permissão, os lembretes não chegam.</T>
          {permission === 'denied' ? (
            <Button title="Abrir configurações do aparelho" onPress={() => Linking.openSettings()} />
          ) : (
            <Button title="Permitir notificações" onPress={allow} />
          )}
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <Row
          title="Lembrete de treino"
          hint="Só nos dias que têm treino no seu plano ativo. Dia de descanso não notifica."
          value={prefs.workout.enabled}
          onValueChange={(enabled) => update({ ...prefs, workout: { ...prefs.workout, enabled } })}
        />
        <T variant="label">Horário do lembrete</T>
        <TimeStepper
          hour={prefs.workout.hour}
          minute={prefs.workout.minute}
          disabled={!prefs.workout.enabled}
          onChange={(hour, minute) => update({ ...prefs, workout: { ...prefs.workout, hour, minute } })}
        />
      </Card>

      <Card style={{ gap: space.md }}>
        <Row
          title="Lembrete de refeição"
          hint="Cinco por dia, para você registrar o que comer."
          value={prefs.meals.enabled}
          onValueChange={(enabled) => update({ ...prefs, meals: { enabled } })}
        />
        <T variant="muted">{MEAL_REMINDERS.map((m) => `${String(m.hour).padStart(2, '0')}:${String(m.minute).padStart(2, '0')} ${m.label}`).join(' · ')}</T>
      </Card>

      <Card style={{ gap: space.md }}>
        <Row
          title="Hidratação"
          hint={`A cada 2 horas, das ${pad(WATER_HOURS[0])}:00 às ${pad(WATER_HOURS[WATER_HOURS.length - 1])}:00. Não é enviada se você informou no perfil que bebe mais de 2 L por dia.`}
          value={prefs.water.enabled}
          onValueChange={(enabled) => update({ ...prefs, water: { enabled } })}
        />
      </Card>

      {scheduled !== null && permission === 'granted' ? (
        <T variant="muted">{scheduled === 0 ? 'Nenhum lembrete agendado.' : `${scheduled} ${scheduled === 1 ? 'lembrete agendado' : 'lembretes agendados'} neste aparelho.`}</T>
      ) : null}
      <Button title="Enviar notificação de teste" kind="secondary" onPress={test} disabled={blocked} />
    </ScrollView>
  );
}
