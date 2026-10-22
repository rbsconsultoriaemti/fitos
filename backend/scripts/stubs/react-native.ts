// Só o que a lógica do app (mobile/src/lib) precisa do react-native quando roda no Node.
export const Platform = { OS: 'node' as string };
export const AppState = { addEventListener: () => ({ remove: () => undefined }) };
