// Formatos das respostas da API (ver STATUS.md dos módulos no backend).

export type Role =
  | 'student'
  | 'trainer'
  | 'running_coach'
  | 'cycling_coach'
  | 'nutritionist'
  | 'psychologist'
  | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

// ---------- musculação ----------

export interface PlanSummary {
  id: string;
  title: string;
  source: 'ai' | 'trainer' | 'self';
  status: 'draft' | 'active' | 'archived';
}

export interface WorkoutSet {
  id: string;
  order: number;
  exercise: { id: string; name: string; videoUrl: string | null; imageUrls: string[]; category: string };
  sets: number;
  reps: string | null; // "10" ou faixa "8-12"; null no cardio (prescrito por tempo/distância)
  loadKg: number | null;
  restSeconds: number | null;
  durationMin: number | null;
  distanceKm: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  muscleGroup: string;
  equipment: string | null;
}

export interface WorkoutDay {
  id: string;
  dayOfWeek: number; // 1 = segunda ... 7 = domingo
  muscleGroup: string;
  notes: string | null;
  sets: WorkoutSet[];
}

export interface WorkoutPlan extends PlanSummary {
  durationWeeks: number | null;
  days: WorkoutDay[];
}

// ---------- nutrição ----------

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Portion {
  label: string;
  grams: number;
}

export interface Food {
  id: string;
  name: string;
  source: 'taco' | 'custom';
  category: string | null;
  kcalPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
  portions: Portion[];
}

export interface Macros {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface LogEntry extends Macros {
  id: string;
  food: { id: string; name: string };
  mealType: MealType;
  quantityG: number;
  portion: { label: string; count: number } | null;
}

export interface ProgressItem {
  consumed: number;
  target: number;
  remaining: number; // negativo = passou da meta
  percent: number;
}

export interface DayLog {
  date: string;
  meals: { type: MealType; label: string; totals: Macros; entries: LogEntry[] }[];
  totals: Macros;
  targets: { kcal: number | null; proteinG: number | null; carbG: number | null; fatG: number | null } | null;
  progress: { kcal: ProgressItem | null; proteinG: ProgressItem | null; carbG: ProgressItem | null; fatG: ProgressItem | null } | null;
}

export interface LogSummary {
  id: string;
  planId: string;
  dayId: string;
  performedAt: string;
  perceivedEffort: number | null;
  notes: string | null;
  dayOfWeek: number | null;
  muscleGroup: string | null;
  setsDone: number;
  volumeKg: number;
  distanceKm: number;
  durationMin: number;
}

interface LogSetValues {
  sets: number;
  reps: string | number | null;
  loadKg: number | null;
  durationMin: number | null;
  distanceKm: number | null;
}

export interface LogDetail {
  id: string;
  performedAt: string;
  perceivedEffort: number | null;
  notes: string | null;
  sets: {
    setId: string;
    exercise: string;
    prescribed: LogSetValues & { reps: string | null };
    done: LogSetValues & { reps: number | null };
  }[];
}
