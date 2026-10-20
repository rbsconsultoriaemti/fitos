import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, ApiError } from './api';
import type { PlanSummary, User, WorkoutPlan } from './types';

// Tudo que o treino precisa para funcionar sem sinal (academia no subsolo):
// plano ativo em cache, treino em andamento salvo no aparelho e fila de treinos finalizados offline.

const PLAN_KEY = 'fitos.cache.plan';
const USER_KEY = 'fitos.cache.user';
const DRAFT_KEY = 'fitos.draft.workout';
const QUEUE_KEY = 'fitos.queue.workoutLogs';

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown | null) {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem armazenamento: o app segue funcionando só online.
  }
}

export const isOffline = (err: unknown) => err instanceof ApiError && err.status === 0;

// ---------- usuário ----------

export const getCachedUser = () => read<User>(USER_KEY);
export const setCachedUser = (user: User | null) => write(USER_KEY, user);

// ---------- plano ativo ----------

export const getCachedPlan = () => read<WorkoutPlan>(PLAN_KEY);

/** Busca o plano ativo; sem rede, devolve a última cópia salva (`offline: true`). */
export async function loadActivePlan(): Promise<{ plan: WorkoutPlan | null; offline: boolean }> {
  try {
    const plans = await api<PlanSummary[]>('/workout/plans?status=active');
    const plan = plans[0] ? await api<WorkoutPlan>(`/workout/plans/${plans[0].id}`) : null;
    await write(PLAN_KEY, plan);
    return { plan, offline: false };
  } catch (err) {
    if (!isOffline(err)) throw err;
    const cached = await getCachedPlan();
    if (!cached) throw err;
    return { plan: cached, offline: true };
  }
}

// A tela de edição avisa que o plano mudou; a aba Treino recarrega ao voltar.
let planStale = false;
export const markPlanStale = () => {
  planStale = true;
};
export const consumePlanStale = () => {
  const stale = planStale;
  planStale = false;
  return stale;
};

// ---------- treino em andamento ----------

export interface WorkoutDraft {
  planId: string;
  dayId: string;
  startedAt: number | null;
  progress: Record<string, { done: number; load: string; reps: string; duration?: string; distance?: string }>;
}

export const getDraft = () => read<WorkoutDraft>(DRAFT_KEY);
export const setDraft = (draft: WorkoutDraft | null) => write(DRAFT_KEY, draft);

// ---------- treinos finalizados aguardando envio ----------

export interface PendingLog {
  planId: string;
  dayId: string;
  performedAt: string;
  perceivedEffort?: number;
  notes?: string;
  sets: {
    setId: string;
    setsDone: number;
    loadDoneKg?: number;
    repsDone?: number;
    durationDoneMin?: number;
    distanceDoneKm?: number;
  }[];
}

export const getPendingLogs = async () => (await read<PendingLog[]>(QUEUE_KEY)) ?? [];

export async function queueLog(log: PendingLog) {
  await write(QUEUE_KEY, [...(await getPendingLogs()), log]);
}

let syncing: Promise<number> | null = null;

/** Envia os treinos guardados, em ordem. Para no primeiro erro de rede. Devolve quantos foram enviados. */
export function syncPendingLogs(): Promise<number> {
  syncing ??= (async () => {
    let sent = 0;
    for (let queue = await getPendingLogs(); queue.length > 0; queue = await getPendingLogs()) {
      try {
        await api('/workout/logs', { method: 'POST', body: queue[0] });
      } catch (err) {
        if (isOffline(err)) break;
        // Rejeitado pelo servidor (ex.: plano arquivado): descartar para não travar a fila.
        if (!(err instanceof ApiError) || err.status < 400 || err.status >= 500 || err.status === 401) break;
      }
      await write(QUEUE_KEY, queue.slice(1));
      sent++;
    }
    return sent;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Apaga tudo que é do usuário (logout). */
export async function clearOfflineData() {
  await Promise.all([PLAN_KEY, USER_KEY, DRAFT_KEY, QUEUE_KEY].map((k) => write(k, null)));
}
