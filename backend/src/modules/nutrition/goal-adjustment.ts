// Ajuste da meta calórica pelo objetivo (déficit para emagrecer, superávit para ganhar massa...), compartilhado entre
// a meta do onboarding e a meta diária (base + treino).

export type GoalKey = 'lose_fat' | 'gain_muscle' | 'conditioning' | 'maintain' | 'race';

export interface GoalAdjustment {
  /** Percentual sobre o gasto total (ex.: -20). */
  pct: number;
  notes: string[];
}

export function goalAdjustment(goal: GoalKey, bmi: number, age: number): GoalAdjustment {
  const notes: string[] = [];
  let pct = { lose_fat: -20, gain_muscle: 10, conditioning: 0, maintain: 0, race: 5 }[goal];
  if (goal === 'lose_fat') {
    if (bmi >= 30) pct = -25;
    else if (bmi < 20) pct = -10;
  }
  if (goal === 'gain_muscle' && bmi >= 28) pct = 5;
  if (age < 18 && pct !== 0) {
    pct = 0;
    notes.push('Para menores de 18 anos a meta fica na manutenção; déficit ou superávit calórico só com acompanhamento profissional.');
  } else if (goal === 'lose_fat' && bmi < 18.5) {
    pct = 0;
    notes.push('Seu IMC está abaixo do peso: a meta ficou na manutenção. Procure um profissional antes de buscar déficit calórico.');
  }
  return { pct, notes };
}

/** Piso de segurança: nunca abaixo de 90% da TMB nem de 1.200 (mulheres/outro) ou 1.500 kcal (homens). */
export const safetyFloor = (bmr: number, sex: 'male' | 'female' | 'other') => Math.max(bmr * 0.9, sex === 'male' ? 1500 : 1200);

export const isGoalKey = (v: unknown): v is GoalKey => typeof v === 'string' && ['lose_fat', 'gain_muscle', 'conditioning', 'maintain', 'race'].includes(v);
