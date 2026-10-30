import { Appearance } from 'react-native';

import { getItem, setItem } from '@/lib/storage';

const KEY = 'theme-mode';

export type ThemeMode = 'light' | 'dark';

/** Aplica o modo salvo ao app inteiro: useColorScheme, cores e barra de status seguem. */
export async function applyStoredThemeMode(): Promise<void> {
  const mode = await getItem(KEY);
  if (mode === 'light' || mode === 'dark') Appearance.setColorScheme(mode);
}

/** Troca o tema na hora e guarda a escolha para as próximas aberturas. */
export async function setThemeMode(mode: ThemeMode): Promise<void> {
  Appearance.setColorScheme(mode);
  await setItem(KEY, mode);
}
