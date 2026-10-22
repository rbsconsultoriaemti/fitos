import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';

import { getCachedPlan, loadActivePlan } from './offline';
import type { WorkoutPlan } from './types';
import { loadWater, readWaterLocal, type WaterState } from './water';

// Lembretes locais (agendados no aparelho, sem servidor): treino, refeições e água.
// expo-notifications é módulo nativo: em um APK antigo (sem o módulo) tudo aqui vira no-op em vez de derrubar o app.

export interface NotificationPrefs {
  workout: { enabled: boolean; hour: number; minute: number };
  meals: { enabled: boolean };
  water: { enabled: boolean };
}

export const DEFAULT_PREFS: NotificationPrefs = {
  workout: { enabled: true, hour: 7, minute: 0 },
  meals: { enabled: true },
  water: { enabled: true },
};

/** Refeições com horário fixo (hora local do aparelho). */
export const MEAL_REMINDERS = [
  { key: 'breakfast', label: 'café da manhã', hour: 7, minute: 30 },
  { key: 'snack_am', label: 'lanche da manhã', hour: 10, minute: 0 },
  { key: 'lunch', label: 'almoço', hour: 12, minute: 30 },
  { key: 'snack_pm', label: 'lanche da tarde', hour: 15, minute: 30 },
  { key: 'dinner', label: 'jantar', hour: 19, minute: 0 },
] as const;

/** Água: de 2 em 2 horas, das 8h às 20h. */
export const WATER_HOURS = [8, 10, 12, 14, 16, 18, 20];
/** Passou disso da meta no dia: não avisa mais. Abaixo da metade às 16h: aviso urgente. */
export const WATER_QUIET_AT = 0.8;
export const WATER_URGENT_BELOW = 0.5;
export const WATER_URGENT_HOUR = 16;
/** Dias à frente com lembretes de água agendados (hoje + os seguintes), enquanto o app não é aberto de novo. */
const WATER_DAYS_AHEAD = 3;

const PREFS_KEY = 'fitos.notifications.prefs';
const ASKED_KEY = 'fitos.notifications.asked';
const CHANNEL_ID = 'lembretes';

type Notifications = typeof import('expo-notifications');

let moduleCache: Notifications | null | undefined;
/** O módulo nativo, ou null (web, ou APK sem expo-notifications). */
async function mod(): Promise<Notifications | null> {
  if (moduleCache !== undefined) return moduleCache;
  if (Platform.OS === 'web') return (moduleCache = null);
  try {
    const N = await import('expo-notifications');
    // Notificação que chega com o app aberto também aparece como banner.
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    return (moduleCache = N);
  } catch {
    return (moduleCache = null);
  }
}

export async function loadPrefs(): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<NotificationPrefs>) : {};
    return {
      workout: { ...DEFAULT_PREFS.workout, ...saved.workout },
      meals: { ...DEFAULT_PREFS.meals, ...saved.meals },
      water: { ...DEFAULT_PREFS.water, ...saved.water },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: NotificationPrefs) {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento: vale só até fechar o app */
  }
}

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export async function getPermissionState(): Promise<PermissionState> {
  const N = await mod();
  if (!N) return 'unavailable';
  const p = await N.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<PermissionState> {
  const N = await mod();
  if (!N) return 'unavailable';
  await ensureChannel(N);
  const p = await N.requestPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

/** Primeira abertura: pede a permissão uma única vez (depois a pessoa muda na tela de configurações). */
export async function askPermissionOnFirstOpen() {
  try {
    if (await AsyncStorage.getItem(ASKED_KEY)) return;
    if ((await getPermissionState()) === 'undetermined') await requestPermission();
    await AsyncStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* tenta de novo na próxima abertura */
  }
}

async function ensureChannel(N: Notifications) {
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Lembretes',
    importance: N.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
  });
}

/** Séries do dia: soma das séries de cada exercício. */
export const totalSets = (day: WorkoutPlan['days'][number]) => day.sets.reduce((sum, s) => sum + s.sets, 0);

/** ISO (1 = segunda ... 7 = domingo) -> expo-notifications (1 = domingo ... 7 = sábado). */
export const expoWeekday = (isoDay: number) => (isoDay % 7) + 1;

async function activePlan(refresh: boolean): Promise<WorkoutPlan | null> {
  if (!refresh) return getCachedPlan();
  try {
    return (await loadActivePlan()).plan;
  } catch {
    return getCachedPlan(); // sem rede: o plano salvo no aparelho
  }
}

export interface RescheduleOptions {
  /** Busca plano e consumo de água na API antes de agendar (abrir o app, voltar a ele, mudar preferências). */
  refresh?: boolean;
  /** Total de água já conhecido (ex.: acabou de beber): evita nova ida à rede. */
  water?: WaterState;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Cancela tudo e agenda de novo conforme as preferências. Devolve quantos lembretes ficaram agendados.
 * As chamadas rodam uma de cada vez, na ordem, então a última sempre vence.
 */
export function rescheduleAll(options: RescheduleOptions = {}): Promise<number> {
  const run = queue.then(() => doReschedule(options));
  queue = run.catch(() => 0);
  return run;
}

/**
 * Quais lembretes de água agendar a partir de agora, dado o consumo de hoje:
 * - 80% da meta ou mais: nenhum aviso hoje;
 * - horários que já passaram não entram;
 * - às 16h, com menos de 50%: aviso urgente;
 * - nos próximos dias, os horários normais (o consumo deles ainda não existe).
 */
export function planWaterReminders(totalMl: number, goalMl: number, now = new Date()): { when: Date; urgent: boolean }[] {
  const ratio = goalMl > 0 ? totalMl / goalMl : 0;
  const out: { when: Date; urgent: boolean }[] = [];
  for (let day = 0; day < WATER_DAYS_AHEAD; day++) {
    if (day === 0 && ratio >= WATER_QUIET_AT) continue;
    for (const hour of WATER_HOURS) {
      const when = at(day, hour, now);
      if (when.getTime() <= now.getTime() + 30_000) continue;
      out.push({ when, urgent: day === 0 && hour === WATER_URGENT_HOUR && ratio < WATER_URGENT_BELOW });
    }
  }
  return out;
}

/** Data local de hoje + n dias às hh:00. */
const at = (daysAhead: number, hour: number, from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
};

async function doReschedule({ refresh = false, water }: RescheduleOptions): Promise<number> {
  const N = await mod();
  if (!N) return 0;
  try {
    await N.cancelAllScheduledNotificationsAsync();
    if ((await getPermissionState()) !== 'granted') return 0;
    await ensureChannel(N);
    const prefs = await loadPrefs();
    const channelId = Platform.OS === 'android' ? CHANNEL_ID : undefined;
    let count = 0;
    const schedule = async (title: string, body: string, trigger: Record<string, unknown>) => {
      await N.scheduleNotificationAsync({ content: { title, body, sound: false }, trigger: { ...trigger, channelId } as never });
      count++;
    };

    // Treino: um lembrete semanal por dia COM treino no plano ativo; dia de descanso não notifica.
    if (prefs.workout.enabled) {
      const plan = await activePlan(refresh);
      for (const day of plan?.days ?? []) {
        const sets = totalSets(day);
        if (sets === 0) continue;
        await schedule('Hora do treino!', `Você tem ${sets} ${sets === 1 ? 'série' : 'séries'} te esperando hoje 💪`, {
          type: N.SchedulableTriggerInputTypes.WEEKLY,
          weekday: expoWeekday(day.dayOfWeek),
          hour: prefs.workout.hour,
          minute: prefs.workout.minute,
        });
      }
    }

    if (prefs.meals.enabled) {
      for (const m of MEAL_REMINDERS) {
        await schedule(`Hora do ${m.label}!`, 'Não esqueça de registrar o que você comer 🍽️', {
          type: N.SchedulableTriggerInputTypes.DAILY,
          hour: m.hour,
          minute: m.minute,
        });
      }
    }

    // Água, pelo consumo real de hoje: passou de 80% da meta => nada mais hoje; abaixo de 50% às 16h => aviso urgente.
    // Como o consumo muda, os lembretes são avisos únicos (hoje e os próximos dias) e tudo é reagendado a cada gole registrado.
    if (prefs.water.enabled) {
      const state = water ?? (refresh ? await loadWater().catch(() => readWaterLocal()) : await readWaterLocal());
      for (const r of planWaterReminders(state.totalMl, state.goalMl)) {
        await schedule(
          'Hidratação',
          r.urgent ? `Você bebeu pouca água hoje! 💧 Só ${state.totalMl} ml de ${state.goalMl} ml.` : 'Lembre-se de beber água! 💧',
          { type: N.SchedulableTriggerInputTypes.DATE, date: r.when },
        );
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/** Notificação de teste, daqui a 5 segundos. */
export async function sendTestNotification(): Promise<boolean> {
  const N = await mod();
  if (!N || (await getPermissionState()) !== 'granted') return false;
  await ensureChannel(N);
  await N.scheduleNotificationAsync({
    content: { title: 'FitOS', body: 'Está funcionando! Seus lembretes vão chegar assim 💪' },
    trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined } as never,
  });
  return true;
}

/** Logout: some com os lembretes do aparelho. */
export async function cancelAllReminders() {
  const N = await mod();
  await N?.cancelAllScheduledNotificationsAsync().catch(() => undefined);
}

/** Reagenda quando o app volta para o primeiro plano (o dia pode ter virado, o plano pode ter mudado). Devolve a função de cancelar. */
export function rescheduleOnForeground(): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void rescheduleAll({ refresh: true });
  });
  return () => sub.remove();
}
