import { useColorScheme } from 'react-native';

// Paleta no estilo iOS (cores do sistema).
const light = {
  bg: '#F2F2F7', // grouped background
  card: '#FFFFFF',
  text: '#000000',
  muted: '#8E8E93',
  border: '#C6C6C8', // divisórias finas (separator)
  primary: '#007AFF',
  onPrimary: '#FFFFFF',
  primarySoft: '#E5F1FF',
  danger: '#FF3B30',
  warn: '#FF9500',
  track: '#E5E5EA',
  protein: '#007AFF',
  carb: '#FF9500',
  fat: '#FF3B30',
  water: '#32ADE6',
};

const dark: typeof light = {
  bg: '#000000',
  card: '#1C1C1E',
  text: '#FFFFFF',
  muted: '#8E8E93',
  border: '#38383A',
  primary: '#0A84FF',
  onPrimary: '#FFFFFF',
  primarySoft: '#0A2A4D',
  danger: '#FF453A',
  warn: '#FF9F0A',
  track: '#39393D',
  protein: '#0A84FF',
  carb: '#FF9F0A',
  fat: '#FF453A',
  water: '#64D2FF',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

// iOS: campos 10, cards 10–12, botões grandes 14.
export const radius = { sm: 8, md: 10, lg: 12, button: 14 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
