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

export type MealType = 'breakfast' | 'morning_snack' | 'lunch' | 'afternoon_snack' | 'dinner';

export interface Portion {
  label: string;
  grams: number;
}

export interface Food {
  id: string;
  name: string;
  /** Nome de cardápio ('Frango grelhado'); ausente em dados salvos por versões antigas do app. */
  displayName?: string;
  source: 'taco' | 'custom' | 'openfoodfacts';
  category: string | null;
  kcalPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
  portions: Portion[];
  barcode: string | null;
}

export interface Macros {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface LogEntry extends Macros {
  id: string;
  food: { id: string; name: string; displayName?: string };
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
  targets: {
    kcal: number | null;
    kcalSource: 'override' | 'plan' | 'dynamic' | null;
    proteinG: number | null;
    carbG: number | null;
    fatG: number | null;
  } | null;
  progress: { kcal: ProgressItem | null; proteinG: ProgressItem | null; carbG: ProgressItem | null; fatG: ProgressItem | null } | null;
  energy?: EnergyTarget;
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

export interface Profile {
  name: string;
  email: string;
  birthDate: string | null; // AAAA-MM-DD
  sex: 'male' | 'female' | 'other' | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  restingHrBpm: number | null;
  maxHrBpm: number | null;
  goal: string | null;
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced' | null;
  restrictions: string[];
  /** Questionário de onboarding: etapa de retomada e respostas já salvas. */
  onboarding: { step: number; answers: Record<string, unknown>; completedAt: string | null };
  onboardingNeeded: boolean;
}

/** Alimento candidato da base (resultado do reconhecimento por foto ou escolha manual). */
export interface FoodCandidate {
  foodId: string;
  name: string;
  displayName?: string;
  kcalPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
}

export interface RecognizedItem {
  recognized: {
    name: string;
    estimatedGrams: number;
    confidence: number;
    estimated: Macros;
  };
  candidates: FoodCandidate[];
}

export interface RecognitionResult {
  items: RecognizedItem[];
  disclaimer: string;
}

/** Item de refeição a registrar: gramas OU porção caseira. */
export interface NewFoodLog {
  foodId: string;
  mealType: MealType;
  quantityG?: number;
  portion?: { label: string; count: number };
}

/** Meta de calorias: Mifflin-St Jeor × 1,2 + treinos do dia, ou a definida pelo usuário. */
export interface EnergyTarget {
  kcal: number | null;
  source: 'override' | 'dynamic' | null;
  overrideKcal: number | null;
  missing: string[]; // campos do perfil que faltam: weight, height, birthDate, sex
  baseKcal: number | null; // TMB × 1,2
  workoutKcal: number | null; // gasto estimado dos treinos registrados no dia
  workoutDone: boolean;
  tdeeKcal: number | null; // baseKcal + workoutKcal (antes do ajuste do objetivo)
  targetKcal: number | null; // tdeeKcal com o ajuste do objetivo
  goalKey: 'lose_fat' | 'gain_muscle' | 'conditioning' | 'maintain' | 'race' | null;
  goalAdjustmentPct: number; // ex.: -20
  goalAdjustmentKcal: number; // negativo = déficit
  breakdown: {
    bmr: number;
    baseKcal: number;
    exerciseKcal: number;
    activityFactor: number;
    trainingMinutes: number;
    sessions: number;
    muscleGroups: string[];
    dynamicKcal: number;
  } | null;
}

export interface MealTemplate {
  id: string;
  name: string;
  mealType: MealType | null;
  useCount: number; // quantas vezes foi registrada (sugestão "habitual")
  lastUsedAt: string | null;
  items: {
    foodId: string;
    name: string;
    displayName?: string;
    quantityG: number;
    portion: { label: string; count: number } | null;
    kcal: number;
  }[];
  totals: Macros;
}

// ---------- plano alimentar ----------

export type DietPlanSource = 'nutritionist' | 'self' | 'ai';

export interface DietFood {
  id: string;
  food: { id: string; name: string; displayName?: string };
  quantityG: number;
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface DietMeal {
  id: string;
  name: string;
  order: number;
  timeSuggestion: string | null;
  foods: DietFood[];
}

export interface DietPlan {
  id: string;
  patientId: string;
  prescribedBy: string | null;
  title: string;
  source: DietPlanSource;
  status: 'draft' | 'active' | 'archived';
  targets: { kcal: number | null; proteinG: number | null; carbG: number | null; fatG: number | null };
  totals: Macros;
  createdAt: string;
  meals: DietMeal[];
}

/** GET /nutrition/plans/active: o plano em uso (nutricionista > próprio > IA) e o próprio plano, se houver. */
export interface ActiveDietPlans {
  active: DietPlan | null;
  own: DietPlan | null;
}

// ---------- painel do professor ----------

export type TodayStatus = 'trained' | 'pending' | 'rest' | 'no_plan';

export interface TrainerStudentItem {
  id: string;
  name: string;
  goal: string | null;
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced' | null;
  todayStatus: TodayStatus;
  streak: number;
  onStreak: boolean;
  lastWorkoutDate: string | null;
}

export interface TrainerStudents {
  date: string;
  summary: { total: number; trainedToday: number; onStreak: number; streakMin: number };
  students: TrainerStudentItem[];
}

export interface TrainerStudentDetail {
  student: {
    id: string;
    name: string;
    goal: string | null;
    fitnessLevel: 'beginner' | 'intermediate' | 'advanced' | null;
    age: number | null;
    heightCm: number | null;
    weightKg: number | null;
    bmi: number | null;
    bmiCategory: string | null;
    linkedAt: string;
  };
  todayStatus: TodayStatus;
  streak: number;
  plan: WorkoutPlan | null;
  recentLogs: {
    id: string;
    performedAt: string;
    date: string;
    muscleGroup: string | null;
    setsDone: number;
    setsPrescribed: number;
    adherencePct: number | null;
    perceivedEffort: number | null;
  }[];
  weeklyAdherence: { weekStart: string; prescribed: number; done: number; pct: number | null }[];
}

export interface SuggestedPlan {
  title: string;
  durationWeeks: number | null;
  summary: string;
  days: {
    dayOfWeek: number;
    muscleGroup: string;
    notes: string | null;
    sets: { exerciseId: string; exerciseName: string; sets: number; reps?: string; loadKg?: number; restSeconds?: number; durationMin?: number; distanceKm?: number }[];
  }[];
}
