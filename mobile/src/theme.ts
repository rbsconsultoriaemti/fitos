import { useColorScheme } from 'react-native';

// Paleta FitOS: verde-sálvia + pêssego, sobre fundo creme (inspirada na logo).
const light = {
  bg: '#F6F8F5', // fundo creme esverdeado
  card: '#FFFFFF',
  text: '#1F2A24', // títulos e texto principal
  muted: '#6B7A6E', // textos secundários
  border: '#DDE5DB', // divisórias finas
  primary: '#5E7F5B', // verde-sálvia escuro (contraste com texto branco)
  onPrimary: '#FFFFFF',
  primarySoft: '#E4ECE2',
  danger: '#C0564B',
  warn: '#E0884F', // pêssego escurecido para texto/ícones
  track: '#E3E9E1',
  protein: '#5E7F5B',
  carb: '#F4A97F', // pêssego
  fat: '#D9B25C', // ocre
  water: '#6FA3B8', // azul-céu suave
};

const dark: typeof light = {
  bg: '#121714',
  card: '#1C241F',
  text: '#F2F5F1',
  muted: '#9AA89C',
  border: '#2E3A32',
  primary: '#8DA58A', // sálvia mais claro no escuro
  onPrimary: '#10160F',
  primarySoft: '#24332A',
  danger: '#E07A6E',
  warn: '#F4A97F',
  track: '#2E3A32',
  protein: '#8DA58A',
  carb: '#F4A97F',
  fat: '#E0C07A',
  water: '#8CC3D6',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

// Campos 10, cards 10–12, botões grandes 14.
export const radius = { sm: 8, md: 10, lg: 12, button: 14 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
