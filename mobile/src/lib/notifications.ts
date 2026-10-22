import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';

import { api } from './api';
import { getCachedPlan, loadActivePlan } from './offline';
import type { Profile, WorkoutPlan } from './types';

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

const PREFS_KEY = 'fitos.notifications.prefs';
const ASKED_KEY = 'fitos.notifications.asked';
const WATER_KEY = 'fitos.notifications.waterIntake'; // resposta do perfil: 'lt1' | '1to2' | 'gt2'
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

/** Pede o perfil só para saber quanta água a pessoa diz beber (resposta do onboarding); sem rede usa a última salva. */
async function waterIntake(): Promise<string | null> {
  try {
    const profile = await api<Profile>('/profile');
    const value = profile.onboarding?.answers?.water;
    if (typeof value === 'string') {
      await AsyncStorage.setItem(WATER_KEY, value);
      return value;
    }
    await AsyncStorage.removeItem(WATER_KEY);
    return null;
  } catch {
    return (await AsyncStorage.getItem(WATER_KEY).catch(() => null)) ?? null;
  }
}

async function activePlan(): Promise<WorkoutPlan | null> {
  try {
    return (await loadActivePlan()).plan;
  } catch {
    return getCachedPlan(); // sem rede: o plano salvo no aparelho
  }
}

let rescheduling: Promise<number> | null = null;

/**
 * Cancela tudo e agenda de novo conforme as preferências. Devolve quantos lembretes ficaram agendados.
 * Roda ao abrir o app, ao voltar para ele e depois de mudar as preferências.
 */
export function rescheduleAll(): Promise<number> {
  rescheduling ??= doReschedule().finally(() => {
    rescheduling = null;
  });
  return rescheduling;
}

async function doReschedule(): Promise<number> {
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
      const plan = await activePlan();
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

    // Água: o app não sabe quanto foi bebido hoje, então usa o que a pessoa disse no perfil: quem já bebe mais de 2 L não recebe.
    if (prefs.water.enabled && (await waterIntake()) !== 'gt2') {
      for (const hour of WATER_HOURS) {
        await schedule('Hidratação', 'Lembre-se de beber água! 💧', { type: N.SchedulableTriggerInputTypes.DAILY, hour, minute: 0 });
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
  await AsyncStorage.removeItem(WATER_KEY).catch(() => undefined); // dado de saúde da conta que saiu
}

/** Reagenda quando o app volta para o primeiro plano (o dia pode ter virado, o plano pode ter mudado). Devolve a função de cancelar. */
export function rescheduleOnForeground(): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void rescheduleAll();
  });
  return () => sub.remove();
}
