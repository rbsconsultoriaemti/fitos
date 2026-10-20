const pad = (n: number) => String(n).padStart(2, '0');

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
export const fmt0 = (n: number) => nf0.format(n);
export const fmt1 = (n: number) => nf1.format(n);

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const MEAL_LABELS = { breakfast: 'Café', lunch: 'Almoço', dinner: 'Jantar', snack: 'Lanche' } as const;

/** Refeição provável pelo horário (para pré-selecionar). */
export function defaultMeal(d = new Date()): (typeof MEAL_ORDER)[number] {
  const h = d.getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18) return 'snack';
  return 'dinner';
}

/** Sem acento e em minúsculas, para busca local. */
export const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
