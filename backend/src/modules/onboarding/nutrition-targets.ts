import { mifflinStJeor } from '../nutrition/energy.service';
import { goalAdjustment, safetyFloor } from '../nutrition/goal-adjustment';
import type { OnboardingAnswers } from './onboarding.schemas';

// Meta calórica e macros do onboarding: fórmulas fixas (reprodutíveis), não geradas pela IA.
// É uma estimativa para orientar; a prescrição de dieta é de nutricionista habilitado.

export interface NutritionTargets {
  bmi: number;
  bmiCategory: string;
  bmr: number;
  activityFactor: number;
  tdee: number;
  adjustmentPct: number; // ajuste do objetivo sobre o gasto total (ex.: -20)
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  notes: string[];
}

const round = (n: number, step = 1) => Math.round(n / step) * step;

function bmiCategory(bmi: number) {
  if (bmi < 18.5) return 'abaixo do peso';
  if (bmi < 25) return 'peso adequado';
  if (bmi < 30) return 'sobrepeso';
  return 'obesidade';
}

export function computeNutritionTargets(input: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: 'male' | 'female' | 'other';
  goal: OnboardingAnswers['goalKey'];
  daysPerWeek: number;
  sessionMinutes: number;
}): NutritionTargets {
  const { weightKg, heightCm, age, sex, goal } = input;
  const notes: string[] = [];
  const bmi = weightKg / (heightCm / 100) ** 2;
  const bmr = mifflinStJeor({ weightKg, heightCm, age, sex });

  // Fator de atividade pelas horas de treino na semana: 1,2 (sedentário) até no máximo 1,55.
  const weeklyHours = (input.daysPerWeek * input.sessionMinutes) / 60;
  const activityFactor = Math.min(1.55, 1.2 + 0.06 * weeklyHours);
  const tdee = bmr * activityFactor;

  const adj = goalAdjustment(goal, bmi, age);
  const adjustmentPct = adj.pct;
  notes.push(...adj.notes);

  const floor = safetyFloor(bmr, sex);
  let kcal = tdee * (1 + adjustmentPct / 100);
  if (kcal < floor) {
    kcal = floor;
    notes.push('A meta foi limitada ao mínimo de segurança.');
  }
  kcal = round(kcal, 10);

  // Macros por kg de peso de referência (com obesidade, usa o peso de IMC 27 para não inflar a proteína).
  const refWeight = bmi > 30 ? 27 * (heightCm / 100) ** 2 : weightKg;
  const proteinPerKg = { lose_fat: 2.0, gain_muscle: 1.8, conditioning: 1.6, maintain: 1.4, race: 1.6 }[goal];
  let proteinG = refWeight * proteinPerKg;
  const fatG = Math.max(refWeight * 0.9, (kcal * 0.2) / 9);
  let carbG = (kcal - proteinG * 4 - fatG * 9) / 4;
  if (carbG < 50) {
    // meta muito baixa: sobra pouco para carboidrato; reduz a proteína ao mínimo de 1,2 g/kg antes de zerar o carbo
    proteinG = Math.max(refWeight * 1.2, (kcal - fatG * 9 - 200) / 4);
    carbG = Math.max(50, (kcal - proteinG * 4 - fatG * 9) / 4);
  }

  return {
    bmi: Math.round(bmi * 10) / 10,
    bmiCategory: bmiCategory(bmi),
    bmr: round(bmr),
    activityFactor: Math.round(activityFactor * 100) / 100,
    tdee: round(tdee),
    adjustmentPct,
    kcal,
    proteinG: round(proteinG),
    carbG: round(carbG),
    fatG: round(fatG),
    notes,
  };
}
