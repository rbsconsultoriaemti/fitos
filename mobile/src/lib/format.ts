const pad = (n: number) => String(n).padStart(2, '0');

/** Nome de cardápio do alimento (a API manda `displayName`); cai no nome original se faltar. */
export const foodLabel = (f: { name: string; displayName?: string }) => f.displayName || f.name;

/** Data local no formato YYYY-MM-DD (não usar toISOString: ele converte para UTC e troca o dia à noite). */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

export function dateLabel(date: string): string {
  const today = localDate();
  if (date === today) return 'Hoje';
  if (date === addDays(today, -1)) return 'Ontem';
  if (date === addDays(today, 1)) return 'Amanhã';
  const [y, m, d] = date.split('-').map(Number);
  const weekday = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(y, m - 1, d).getDay()];
  return `${weekday}, ${pad(d)}/${pad(m)}`;
}

/** Dia da semana como a API usa: 1 = segunda ... 7 = domingo. */
export function isoWeekday(d = new Date()): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}

export const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/** Aceita vírgula ou ponto ("42,5"). Retorna null para vazio/inválido. */
export function parseDecimal(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
}

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
/** Número finito de verdade (rejeita NaN, Infinity, null e undefined). */
export const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// Nunca mostra "NaN": valor inválido vira "—".
export const fmt0 = (n: number | null | undefined) => (isNum(n) ? nf0.format(n) : '—');
export const fmt1 = (n: number | null | undefined) => (isNum(n) ? nf1.format(n) : '—');

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export const MEAL_ORDER = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner'] as const;
export const MEAL_LABELS = {
  breakfast: 'Café',
  morning_snack: 'Lanche manhã',
  lunch: 'Almoço',
  afternoon_snack: 'Lanche tarde',
  dinner: 'Jantar',
  snack: 'Lanche', // tipo antigo: itens salvos offline por uma versão anterior do app
} as const;

/** Refeição provável pelo horário (para pré-selecionar). */
export function defaultMeal(d = new Date()): (typeof MEAL_ORDER)[number] {
  const h = d.getHours();
  if (h < 10) return 'breakfast';
  if (h < 12) return 'morning_snack';
  if (h < 15) return 'lunch';
  if (h < 18) return 'afternoon_snack';
  return 'dinner';
}

/** Sem acento e em minúsculas, para busca local. */
export const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const LEVEL_LABELS = { beginner: 'Iniciante', intermediate: 'Intermediário', advanced: 'Avançado' } as const;

/** "Maria da Silva" -> "M" */
export const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/** YYYY-MM-DD -> "dd/mm" */
export const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
