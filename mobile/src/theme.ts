import { useColorScheme } from 'react-native';

const light = {
  bg: '#F4F6F5',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  primary: '#16A34A',
  onPrimary: '#FFFFFF',
  primarySoft: '#DCFCE7',
  danger: '#DC2626',
  warn: '#D97706',
  track: '#E5E7EB',
  protein: '#3B82F6',
  carb: '#F59E0B',
  fat: '#EF4444',
};

const dark: typeof light = {
  bg: '#0B0E0D',
  card: '#151A18',
  text: '#F3F4F6',
  muted: '#9CA3AF',
  border: '#262D2A',
  primary: '#22C55E',
  onPrimary: '#04210E',
  primarySoft: '#12351F',
  danger: '#F87171',
  warn: '#FBBF24',
  track: '#262D2A',
  protein: '#60A5FA',
  carb: '#FBBF24',
  fat: '#F87171',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { sm: 8, md: 12, lg: 16 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
