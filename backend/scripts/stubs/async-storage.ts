// Substitui o AsyncStorage do React Native quando o script reutiliza a lógica do app (mobile/src/lib/onboarding.ts) no Node.
const store = new Map<string, string>();

export default {
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => void store.set(k, v),
  removeItem: async (k: string) => void store.delete(k),
};
