# STATUS — mobile

- Estado: app do aluno (Expo SDK 58 + expo-router) com login/cadastro, Home e Treino. Typecheck e bundle Android OK; ainda não testado em celular físico.
- Rodar: `npx expo start` com `EXPO_PUBLIC_API_URL` apontando para a API (celular físico: IP do PC na rede).

## Telas
- `(auth)/login`, `(auth)/register` (cadastro sempre como `student`)
- `(tabs)/index` — Início: treino de hoje + resumo nutricional do dia
- `(tabs)/workout` — séries, carga/reps, descanso com vibração, finalizar treino

## Modo offline (academia no subsolo) — `src/lib/offline.ts`
- Plano ativo é salvo no aparelho a cada carga online e usado quando não há rede
- Abrir o app sem rede entra com o usuário salvo; refresh falho por rede NÃO desloga
- Treino em andamento é salvo a cada toque (sobrevive a fechar o app)
- Treino finalizado offline entra numa fila e é enviado ao abrir Início/Treino ou puxar para atualizar
- Timeout de 8 s nas requisições (sinal fraco conta como offline)
- Logout apaga cache e fila

## Limitações / pendências
- Fila: erro 4xx do servidor descarta o treino; sem chave de idempotência, reenvio pode duplicar
- Primeiro acesso precisa de internet (para baixar o plano)
- Falta a tela de Nutrição (a Home ainda não tem atalho para ela)
- API precisa estar acessível pela internet (deploy Railway ou túnel) para uso fora de casa
- Testar em aparelho: modo avião, fechar/reabrir, finalizar offline e sincronizar
