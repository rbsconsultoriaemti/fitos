import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// SecureStore não existe na web; lá o fallback é o localStorage (só para desenvolvimento).

export async function getItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Sem armazenamento disponível: a sessão só dura enquanto o app estiver aberto.
  }
}
