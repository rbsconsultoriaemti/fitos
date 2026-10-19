import { Platform } from 'react-native';

/**
 * URL da API do backend (padrão: porta 3000 da máquina de desenvolvimento).
 * - Web e simulador iOS: `localhost` aponta para o próprio computador.
 * - Emulador Android: `localhost` é o próprio emulador; o computador é `10.0.2.2`.
 * - Celular físico (Expo Go): use o IP do computador na rede, em EXPO_PUBLIC_API_URL
 *   (ex.: http://192.168.0.10:3000). O celular e o computador precisam estar na mesma rede.
 */
const defaultUrl = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? defaultUrl).replace(/\/+$/, '');
