import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, View } from 'react-native';

import { Button, Card, ProgressBar, T } from '@/components/ui';
import { errorMessage } from '@/lib/dialog';
import { localDate } from '@/lib/format';
import { rescheduleAll } from '@/lib/notifications';
import { addWater, loadWater, readWaterLocal, undoLastWater, waterLevel, WATER_PRESETS, type WaterState } from '@/lib/water';
import { radius, space, useColors } from '@/theme';

const GLASS_W = 72;
const GLASS_H = 104;

/** Copo que vai enchendo (a altura da água anima até o percentual de hoje). */
function Glass({ percent }: { percent: number }) {
  const c = useColors();
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: Math.min(Math.max(percent, 0), 100) / 100, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [percent, fill]);
  const height = fill.interpolate({ inputRange: [0, 1], outputRange: [0, GLASS_H - 6] });
  return (
    <View
      accessibilityLabel={`Copo com ${Math.min(percent, 100)}% da meta`}
      style={{
        width: GLASS_W,
        height: GLASS_H,
        borderWidth: 3,
        borderColor: c.border,
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        borderBottomLeftRadius: radius.lg,
        borderBottomRightRadius: radius.lg,
        backgroundColor: c.track,
        overflow: 'hidden',
        justifyContent: 'flex-end',
      }}
    >
      <Animated.View style={{ height, backgroundColor: c.water, opacity: 0.9 }} />
    </View>
  );
}

/** Card "Hidratação": total do dia × meta, copo animado, barra por faixa e botões de gole/copo/garrafa. */
export function WaterWidget() {
  const c = useColors();
  const [state, setState] = useState<WaterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const day = useRef(localDate());

  const refresh = useCallback(async () => {
    day.current = localDate();
    setState(await loadWater().catch(() => readWaterLocal()));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Reset à meia-noite: ao voltar ao app e por um temporizador até a virada do dia, o total é recalculado para o dia novo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && day.current !== localDate()) void refresh();
    });
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2).getTime() - now.getTime();
    const timer = setTimeout(() => void refresh(), midnight);
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [refresh, state?.date]);

  async function run(action: () => Promise<WaterState>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setState(next);
      void rescheduleAll({ water: next }); // lembretes de água passam a considerar o novo total
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const percent = state?.percent ?? 0;
  const level = waterLevel(percent);
  const barColor = level === 'low' ? c.danger : level === 'mid' ? c.warn : c.primary;

  return (
    <Card style={{ gap: space.md }}>
      <T variant="h2">Hidratação</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <Glass percent={percent} />
        <View style={{ flex: 1, gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <T variant="number">{state ? state.totalMl : '–'}</T>
            <T variant="muted">{`ml de ${state?.goalMl ?? '–'} ml`}</T>
          </View>
          <T variant="label" style={{ color: barColor }}>{`${percent}% da meta de hoje`}</T>
          <ProgressBar value={Math.min(percent / 100, 1)} color={barColor} height={10} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {WATER_PRESETS.map((p) => (
          <Button key={p.ml} title={`+${p.ml} ml`} kind="secondary" style={{ flex: 1 }} disabled={busy || !state} onPress={() => run(() => addWater(p.ml))} />
        ))}
      </View>
      <T variant="muted">Gole 150 ml · Copo 250 ml · Garrafa 500 ml</T>

      {state && state.pending > 0 ? (
        <T variant="muted">{`${state.pending} ${state.pending === 1 ? 'registro aguardando' : 'registros aguardando'} envio — ${state.offline ? 'sobem quando houver internet' : 'enviando…'}`}</T>
      ) : state?.offline ? (
        <T variant="muted">Sem conexão: o total é calculado neste aparelho.</T>
      ) : null}
      {error ? <T variant="muted" style={{ color: c.danger }}>{error}</T> : null}
      {state && state.entries > 0 ? <Button title="Desfazer último" kind="ghost" disabled={busy} onPress={() => run(undoLastWater)} /> : null}
    </Card>
  );
}
