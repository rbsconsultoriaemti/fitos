import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, ApiError } from './api';
import { localDate } from './format';

// Registro de água com fila offline: todo gole entra primeiro na fila do aparelho (com um clientId) e sobe em seguida.
// O total mostrado é sempre "o que o servidor já tem" + "o que ainda está na fila", então funciona sem internet
// e o reenvio não duplica (o servidor ignora o mesmo clientId).

export const WATER_PRESETS = [
  { ml: 150, label: 'Gole' },
  { ml: 250, label: 'Copo' },
  { ml: 500, label: 'Garrafa' },
] as const;

export const DEFAULT_GOAL_ML = 2000;

interface ServerEntry {
  id: string;
  amountMl: number;
  loggedAt: string;
}

interface ServerDay {
  totalMl: number;
  goalMl: number;
  entries: ServerEntry[];
}

interface WaterCache extends ServerDay {
  date: string; // dia local a que o cache se refere
}

export interface PendingWater {
  clientId: string;
  amountMl: number;
  loggedAt: string;
}

export interface WaterState {
  date: string;
  goalMl: number;
  totalMl: number;
  percent: number;
  pending: number; // registros ainda não enviados
  entries: number;
  offline: boolean;
}

const CACHE_KEY = 'fitos.water.cache';
const QUEUE_KEY = 'fitos.water.queue';
export const WATER_KEYS = [CACHE_KEY, QUEUE_KEY];

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
    /* sem armazenamento: vale só até fechar o app */
  }
}

const isNetworkError = (err: unknown) => err instanceof ApiError && err.status === 0;
const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Dia local (YYYY-MM-DD) de um instante ISO. */
const dayOf = (iso: string) => localDate(new Date(iso));

/** Estado a partir do cache do servidor (só vale se for de hoje) + fila. Não usa a rede. */
function compose(cache: WaterCache | null, queue: PendingWater[], offline: boolean): WaterState {
  const today = localDate();
  const server = cache && cache.date === today ? cache : null;
  const pending = queue.filter((p) => dayOf(p.loggedAt) === today);
  const goalMl = cache?.goalMl ?? DEFAULT_GOAL_ML;
  const totalMl = (server?.totalMl ?? 0) + pending.reduce((sum, p) => sum + p.amountMl, 0);
  return {
    date: today,
    goalMl,
    totalMl,
    percent: Math.round((totalMl / goalMl) * 100),
    pending: queue.length,
    entries: (server?.entries.length ?? 0) + pending.length,
    offline,
  };
}

/** Total de hoje calculado só com o que há no aparelho (usado offline e nas notificações). */
export async function readWaterLocal(): Promise<WaterState> {
  const [cache, queue] = await Promise.all([read<WaterCache>(CACHE_KEY), read<PendingWater[]>(QUEUE_KEY)]);
  return compose(cache, queue ?? [], true);
}

let flushing: Promise<void> | null = null;

/** Envia a fila em ordem. Para no primeiro erro de rede; registro recusado pelo servidor (4xx) é descartado. */
export function flushWaterQueue(): Promise<void> {
  flushing ??= doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush() {
  let queue = (await read<PendingWater[]>(QUEUE_KEY)) ?? [];
  while (queue.length > 0) {
    const item = queue[0];
    try {
      await api('/nutrition/water', { method: 'POST', body: { amountMl: item.amountMl, loggedAt: item.loggedAt, clientId: item.clientId }, timeoutMs: 8000 });
    } catch (err) {
      if (isNetworkError(err)) return;
      if (!(err instanceof ApiError && err.status >= 400 && err.status < 500)) return; // 5xx: tenta de novo depois
      // 4xx: o servidor nunca vai aceitar esse registro; descarta para não travar a fila
    }
    // relê a fila: pode ter entrado registro novo (ou o desfazer ter tirado este) durante o envio
    queue = ((await read<PendingWater[]>(QUEUE_KEY)) ?? []).filter((p) => p.clientId !== item.clientId);
    await write(QUEUE_KEY, queue.length ? queue : null);
  }
}

/** Atualiza do servidor (enviando antes a fila); sem rede, devolve o cálculo local. */
export async function loadWater(): Promise<WaterState> {
  let reached = true;
  try {
    await flushWaterQueue();
    const day = await api<ServerDay & { date: string | null }>(`/nutrition/water/today?date=${localDate()}`, { timeoutMs: 8000 });
    await write(CACHE_KEY, { date: localDate(), totalMl: day.totalMl, goalMl: day.goalMl, entries: day.entries } satisfies WaterCache);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    reached = false;
  }
  const [cache, queue] = await Promise.all([read<WaterCache>(CACHE_KEY), read<PendingWater[]>(QUEUE_KEY)]);
  return compose(cache, queue ?? [], !reached);
}

/** Registra um consumo: entra na fila na hora (o total já sobe) e tenta enviar. */
export async function addWater(amountMl: number): Promise<WaterState> {
  const queue = (await read<PendingWater[]>(QUEUE_KEY)) ?? [];
  queue.push({ clientId: newClientId(), amountMl, loggedAt: new Date().toISOString() });
  await write(QUEUE_KEY, queue);
  return loadWater().catch(() => readWaterLocal());
}

/** Desfaz o último registro: um que ainda está na fila é só descartado; um já enviado é apagado no servidor (exige internet). */
export async function undoLastWater(): Promise<WaterState> {
  const queue = (await read<PendingWater[]>(QUEUE_KEY)) ?? [];
  const today = localDate();
  const lastPending = [...queue].reverse().find((p) => dayOf(p.loggedAt) === today);
  if (lastPending) {
    await write(QUEUE_KEY, queue.filter((p) => p.clientId !== lastPending.clientId));
    return readWaterLocal().then((s) => ({ ...s, offline: false }));
  }
  const cache = await read<WaterCache>(CACHE_KEY);
  const last = cache && cache.date === today ? cache.entries[cache.entries.length - 1] : undefined;
  if (!last) return readWaterLocal();
  await api(`/nutrition/water/${last.id}`, { method: 'DELETE', timeoutMs: 8000 }); // sem rede: lança e a tela avisa
  return loadWater();
}

export async function clearWaterData() {
  await Promise.all(WATER_KEYS.map((k) => write(k, null)));
}

/** Cor da barra: vermelho < 50%, amarelo 50–80%, verde > 80%. */
export function waterLevel(percent: number): 'low' | 'mid' | 'high' {
  return percent < 50 ? 'low' : percent <= 80 ? 'mid' : 'high';
}
