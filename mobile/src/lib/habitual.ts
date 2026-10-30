import type { MealTemplate, MealType } from './types';

/** Ordena pela frequência de uso (mais usada primeiro; empate: a usada mais recentemente). */
export function byFrequency(templates: MealTemplate[]): MealTemplate[] {
  return [...templates].sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
}

/**
 * Favorita "habitual" para uma refeição vazia: a mais usada entre as que são dessa refeição (ou sem refeição definida).
 * Só sugere o que já foi registrado pelo menos uma vez.
 */
export function habitualFor(templates: MealTemplate[], meal: MealType): MealTemplate | null {
  const candidates = templates.filter((t) => (t.useCount ?? 0) > 0 && (t.mealType === null || t.mealType === meal));
  return byFrequency(candidates)[0] ?? null;
}
