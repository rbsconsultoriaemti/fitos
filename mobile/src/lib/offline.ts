import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';

import { api, ApiError } from './api';
import { normalize } from './format';
import { ONBOARDING_KEYS } from './onboarding';
import type { DayLog, Food, FoodCandidate, LogSummary, MealTemplate, MealType, NewFoodLog, PlanSummary, User, WorkoutPlan } from './types';

// Tudo que o treino precisa para funcionar sem sinal (academia no subsolo):
// plano ativo em cache, treino em andamento salvo no aparelho e fila de treinos finalizados offline.

const PLAN_KEY = 'fitos.cache.plan';
const USER_KEY = 'fitos.cache.user';
const DRAFT_KEY = 'fitos.draft.workout';
const QUEUE_KEY = 'fitos.queue.workoutLogs';
const HISTORY_KEY = 'fitos.cache.history';
const DAYS_KEY = 'fitos.cache.nutritionDays';
const FOODS_KEY = 'fitos.cache.foods';
const RECENT_KEY = 'fitos.cache.recentFoods';
const FOOD_QUEUE_KEY = 'fitos.queue.foodLogs';
const TEMPLATES_KEY = 'fitos.cache.mealTemplates';

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

/** Baixa as demonstrações dos exercícios do plano para o cache em disco (sem esperar, sem falhar). */
function prefetchImages(plan: WorkoutPlan) {
  const urls = plan.days.flatMap((d) => d.sets.flatMap((s) => s.exercise.imageUrls ?? []));
  if (urls.length > 0) Image.prefetch([...new Set(urls)], 'disk').catch(() => {});
}

/** Busca o plano ativo; sem rede, devolve a última cópia salva (`offline: true`). */
export async function loadActivePlan(): Promise<{ plan: WorkoutPlan | null; offline: boolean }> {
  try {
    const plans = await api<PlanSummary[]>('/workout/plans?status=active');
    const plan = plans[0] ? await api<WorkoutPlan>(`/workout/plans/${plans[0].id}`) : null;
    await write(PLAN_KEY, plan);
    if (plan) prefetchImages(plan);
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

// ---------- histórico de treinos ----------

/** Histórico para a aba Progresso; sem rede, devolve a última cópia salva. */
export async function loadHistory(): Promise<{ logs: LogSummary[]; offline: boolean }> {
  try {
    const logs = await api<LogSummary[]>('/workout/logs');
    await write(HISTORY_KEY, logs);
    return { logs, offline: false };
  } catch (err) {
    if (!isOffline(err)) throw err;
    const cached = await read<LogSummary[]>(HISTORY_KEY);
    if (!cached) throw err;
    return { logs: cached, offline: true };
  }
}

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

// ---------- nutrição: dia, alimentos e fila de registros ----------

const MAX_CACHED_DAYS = 30;
const MAX_CACHED_FOODS = 500;
const MAX_RECENT_FOODS = 15;

/** Resumo do dia; sem rede, devolve a última cópia daquela data (ou null se nunca foi aberta). */
export async function loadDay(date: string): Promise<{ day: DayLog | null; offline: boolean }> {
  try {
    const day = await api<DayLog>(`/nutrition/logs?date=${date}`);
    const days = (await read<Record<string, DayLog>>(DAYS_KEY)) ?? {};
    days[date] = day;
    const keep = Object.keys(days).sort().slice(-MAX_CACHED_DAYS);
    await write(DAYS_KEY, Object.fromEntries(keep.map((k) => [k, days[k]])));
    return { day, offline: false };
  } catch (err) {
    if (!isOffline(err)) throw err;
    const days = (await read<Record<string, DayLog>>(DAYS_KEY)) ?? {};
    return { day: days[date] ?? null, offline: true };
  }
}

async function cacheFoods(foods: Food[]) {
  const all = (await read<Record<string, Food>>(FOODS_KEY)) ?? {};
  for (const f of foods) {
    delete all[f.id]; // reinsere no fim: os mais recentes sobrevivem ao corte
    all[f.id] = f;
  }
  const ids = Object.keys(all).slice(-MAX_CACHED_FOODS);
  await write(FOODS_KEY, Object.fromEntries(ids.map((id) => [id, all[id]])));
}

export async function getRecentFoods(): Promise<Food[]> {
  const [ids, all] = await Promise.all([read<string[]>(RECENT_KEY), read<Record<string, Food>>(FOODS_KEY)]);
  return (ids ?? []).map((id) => all?.[id]).filter((f): f is Food => !!f);
}

export async function rememberFood(food: Food) {
  await cacheFoods([food]);
  const ids = ((await read<string[]>(RECENT_KEY)) ?? []).filter((id) => id !== food.id);
  await write(RECENT_KEY, [food.id, ...ids].slice(0, MAX_RECENT_FOODS));
}

/** Busca na API; sem rede, procura entre os alimentos já vistos neste aparelho. */
export async function searchFoods(q: string): Promise<{ foods: Food[]; offline: boolean }> {
  try {
    const foods = await api<Food[]>(`/nutrition/foods?q=${encodeURIComponent(q)}`);
    await cacheFoods(foods);
    return { foods, offline: false };
  } catch (err) {
    if (!isOffline(err)) throw err;
    const tokens = normalize(q).split(/[^a-z0-9]+/).filter(Boolean);
    const all = Object.values((await read<Record<string, Food>>(FOODS_KEY)) ?? {});
    return { foods: all.filter((f) => tokens.every((t) => normalize(f.name).includes(t))).slice(0, 50), offline: true };
  }
}

export async function getFood(id: string): Promise<Food> {
  const cached = (await read<Record<string, Food>>(FOODS_KEY))?.[id];
  if (cached?.portions) return cached;
  const food = await api<Food>(`/nutrition/foods/${id}`);
  await cacheFoods([food]);
  return food;
}

/** Alimento pelo código de barras: primeiro entre os já vistos neste aparelho (funciona offline), depois na API. */
export async function findFoodByBarcode(code: string): Promise<Food> {
  const cached = Object.values((await read<Record<string, Food>>(FOODS_KEY)) ?? {}).find((f) => f.barcode === code);
  if (cached) return cached;
  const food = await api<Food>(`/nutrition/foods/barcode/${code}`);
  await cacheFoods([food]);
  return food;
}

// ---------- refeições favoritas ----------

/** Favoritas do usuário; sem rede, a última cópia salva. */
export async function loadTemplates(): Promise<{ templates: MealTemplate[]; offline: boolean }> {
  try {
    const templates = await api<MealTemplate[]>('/nutrition/templates');
    await write(TEMPLATES_KEY, templates);
    return { templates, offline: false };
  } catch (err) {
    if (!isOffline(err)) throw err;
    return { templates: (await read<MealTemplate[]>(TEMPLATES_KEY)) ?? [], offline: true };
  }
}

export const foodToCandidate = (f: Food): FoodCandidate => ({
  foodId: f.id,
  name: f.name,
  displayName: f.displayName,
  kcalPer100g: f.kcalPer100g,
  proteinPer100g: f.proteinPer100g,
  carbPer100g: f.carbPer100g,
  fatPer100g: f.fatPer100g,
});

export interface PendingFoodLog {
  localId: string;
  date: string; // YYYY-MM-DD do dia em que o aluno comeu
  loggedAt?: string; // só quando não é hoje
  recognitionSource: 'manual' | 'photo_ai';
  item: NewFoodLog;
  /** Para mostrar na lista enquanto não sincroniza. */
  preview: { name: string; mealType: MealType; grams: number; kcal: number };
}

export const getPendingFoodLogs = async () => (await read<PendingFoodLog[]>(FOOD_QUEUE_KEY)) ?? [];

let foodSyncing: Promise<number> | null = null;

/** Envia os registros de comida guardados offline, em ordem. Devolve quantos foram enviados. */
export function syncPendingFoodLogs(): Promise<number> {
  foodSyncing ??= (async () => {
    let sent = 0;
    for (let queue = await getPendingFoodLogs(); queue.length > 0; queue = await getPendingFoodLogs()) {
      const [next] = queue;
      try {
        await api('/nutrition/logs', {
          method: 'POST',
          body: { items: [next.item], loggedAt: next.loggedAt, recognitionSource: next.recognitionSource },
        });
      } catch (err) {
        if (isOffline(err)) break;
        // Rejeitado pelo servidor (ex.: alimento removido): descarta para não travar a fila.
        if (!(err instanceof ApiError) || err.status < 400 || err.status >= 500 || err.status === 401) break;
      }
      await write(FOOD_QUEUE_KEY, queue.slice(1));
      sent++;
    }
    return sent;
  })().finally(() => {
    foodSyncing = null;
  });
  return foodSyncing;
}

/** Meio-dia local da data, em ISO (para registrar em um dia que não é hoje). */
function noonIso(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

export interface FoodLogDraft {
  item: NewFoodLog;
  preview: PendingFoodLog['preview'];
}

/**
 * Registra os alimentos. Com rede, grava direto; sem rede, guarda na fila do aparelho e envia depois.
 * Devolve `queued: true` quando ficou na fila.
 */
export async function addFoodLogs(
  drafts: FoodLogDraft[],
  date: string,
  today: string,
  recognitionSource: 'manual' | 'photo_ai' = 'manual',
): Promise<{ queued: boolean }> {
  const loggedAt = date === today ? undefined : noonIso(date);
  try {
    await api('/nutrition/logs', { method: 'POST', body: { items: drafts.map((d) => d.item), loggedAt, recognitionSource } });
    return { queued: false };
  } catch (err) {
    if (!isOffline(err)) throw err;
    const queue = await getPendingFoodLogs();
    const stamp = Date.now();
    await write(FOOD_QUEUE_KEY, [
      ...queue,
      ...drafts.map((d, i) => ({ localId: `${stamp}-${i}`, date, loggedAt, recognitionSource, item: d.item, preview: d.preview })),
    ]);
    return { queued: true };
  }
}

/** Apaga tudo que é do usuário (logout). */
export async function clearOfflineData() {
  await Promise.all([PLAN_KEY, USER_KEY, DRAFT_KEY, QUEUE_KEY, HISTORY_KEY, DAYS_KEY, FOODS_KEY, RECENT_KEY, FOOD_QUEUE_KEY, TEMPLATES_KEY, ...ONBOARDING_KEYS].map((k) => write(k, null)));
}
