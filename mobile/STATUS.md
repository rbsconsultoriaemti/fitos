# STATUS — mobile

- Estado: app do aluno (Expo SDK 58 + expo-router) com login/cadastro, Home, Treino, Progresso, Perfil e Nutrição. Typecheck e bundle Android OK; ainda não testado em celular físico.
- Rodar: `npx expo start` com `EXPO_PUBLIC_API_URL` apontando para a API (celular físico: IP do PC na rede).

## Telas
- `(auth)/login`, `(auth)/register` (cadastro sempre como `student`)
- `(tabs)/index` — Início: treino de hoje + resumo nutricional do dia
- `(tabs)/workout` — séries, carga/reps, descanso com vibração, finalizar treino
- `(tabs)/nutrition` — dia (navegação por data), resumo kcal/macros × meta, 4 refeições com alimentos e "+", remover alimento, botão Foto → calorias
- `food/search` — busca com debounce (350 ms) em `GET /nutrition/foods?q=`; sem texto mostra os usados recentemente; modo `pick` devolve o alimento à tela anterior
- `food/quantity` — gramas ou porção caseira, prévia de kcal/macros em tempo real, escolha da refeição, salvar (`POST /nutrition/logs`)
- `food/photo` — câmera/galeria (expo-image-picker, qualidade 0,6) → `POST /nutrition/recognize`; confirma/ajusta gramas, troca o alimento (candidatos TACO ou busca) e salva com `recognitionSource: 'photo_ai'`

## Modo offline (academia no subsolo) — `src/lib/offline.ts`
- Plano ativo é salvo no aparelho a cada carga online e usado quando não há rede
- Abrir o app sem rede entra com o usuário salvo; refresh falho por rede NÃO desloga
- Treino em andamento é salvo a cada toque (sobrevive a fechar o app)
- Treino finalizado offline entra numa fila e é enviado ao abrir Início/Treino ou puxar para atualizar
- Timeout de 8 s nas requisições (sinal fraco conta como offline)
- Logout apaga cache e fila
- Nutrição: resumo de cada dia aberto fica salvo (30 dias); alimentos já vistos ficam salvos para busca offline; alimento registrado sem sinal entra numa fila ("Aguardando envio") e sobe sozinho. Remover alimento e foto → calorias exigem internet

## Limitações / pendências
- Fila: erro 4xx do servidor descarta o treino; sem chave de idempotência, reenvio pode duplicar
- Primeiro acesso precisa de internet (para baixar o plano)
- Nutrição: foto → calorias e a fila offline não foram testadas em aparelho; a tela de foto exige `ANTHROPIC_API_KEY` no ai-service (senão 503); itens da foto sem correspondência na TACO não podem ser salvos (só com alimento escolhido); busca offline só encontra alimentos já vistos; editar quantidade de um item já registrado ainda não existe
- `expo-image-picker` é módulo nativo novo: precisa de APK novo (`eas build`)
- API precisa estar acessível pela internet (deploy Railway ou túnel) para uso fora de casa
- Testar em aparelho: modo avião, fechar/reabrir, finalizar offline e sincronizar
