// Regras do painel do professor, sem acesso a banco (testáveis): status do dia, sequência e aderência semanal.
// Datas são strings YYYY-MM-DD no fuso do app.

/** Sequência mínima (treinos prescritos seguidos) para o aluno contar como "em sequência". */
export const STREAK_MIN = 3;
/** Semanas no gráfico de aderência. */
export const ADHERENCE_WEEKS = 8;

export type TodayStatus = 'trained' | 'pending' | 'rest' | 'no_plan';

export interface PlanInfo {
  /** Dia da criação do plano ativo: antes dele não havia treino prescrito. */
  startDate: string;
  /** Dias da semana com treino (1 = segunda ... 7 = domingo). */
  weekdays: Set<number>;
}

const toUtc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, n: number) => fromUtc(toUtc(date) + n * 86_400_000);
export const isoWeekdayOf = (date: string) => new Date(toUtc(date)).getUTCDay() || 7;
export const mondayOf = (date: string) => addDays(date, 1 - isoWeekdayOf(date));

/** Hoje (YYYY-MM-DD) no fuso informado. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function todayStatus(plan: PlanInfo | null, logDates: Set<string>, today: string): TodayStatus {
  if (logDates.has(today)) return 'trained';
  if (!plan) return 'no_plan';
  return plan.weekdays.has(isoWeekdayOf(today)) ? 'pending' : 'rest';
}

/**
 * Treinos prescritos seguidos, de hoje para trás. Dia de descanso não quebra a sequência; um treino prescrito sem
 * registro quebra. Hoje ainda sem registro não quebra (o aluno pode treinar mais tarde).
 */
export function streak(plan: PlanInfo | null, logDates: Set<string>, today: string): number {
  if (!plan) return 0;
  let count = 0;
  for (let i = 0; i < 366; i++) {
    const day = addDays(today, -i);
    if (day < plan.startDate) break;
    if (!plan.weekdays.has(isoWeekdayOf(day))) continue;
    if (logDates.has(day)) count++;
    else if (i === 0) continue;
    else break;
  }
  return count;
}

export interface WeekAdherence {
  weekStart: string;
  prescribed: number;
  done: number;
  /** null quando não havia treino prescrito na semana. */
  pct: number | null;
}

/**
 * Aderência por semana (segunda a domingo), das mais antigas para a atual: dias de treino prescritos que tiveram
 * registro ÷ dias de treino prescritos. Conta só dias a partir da criação do plano e até hoje (hoje só se já treinou).
 */
export function weeklyAdherence(plan: PlanInfo | null, logDates: Set<string>, today: string, weeks = ADHERENCE_WEEKS): WeekAdherence[] {
  const thisMonday = mondayOf(today);
  const out: WeekAdherence[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = addDays(thisMonday, -7 * w);
    let prescribed = 0;
    let done = 0;
    for (let i = 0; i < 7 && plan; i++) {
      const day = addDays(weekStart, i);
      if (day < plan.startDate || day > today || !plan.weekdays.has(isoWeekdayOf(day))) continue;
      const trained = logDates.has(day);
      if (day === today && !trained) continue;
      prescribed++;
      if (trained) done++;
    }
    out.push({ weekStart, prescribed, done, pct: prescribed > 0 ? Math.round((done / prescribed) * 100) : null });
  }
  return out;
}
