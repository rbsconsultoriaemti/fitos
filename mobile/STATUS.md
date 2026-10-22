# STATUS — mobile

- Estado: app do aluno (Expo SDK 58 + expo-router) com login/cadastro, Home, Treino, Progresso, Perfil e Nutrição. Typecheck e bundle Android OK; ainda não testado em celular físico.
- Rodar: `npx expo start` com `EXPO_PUBLIC_API_URL` apontando para a API (celular físico: IP do PC na rede).

## Telas
- `(auth)/login`, `(auth)/register` (cadastro sempre como `student`)
- `onboarding` — questionário de 7 etapas com barra de progresso (dados pessoais, objetivo, nível, rotina, alimentação, saúde, resumo). Abre sozinho após o login quando `GET /profile` devolve `onboardingNeeded` (só `student`). Salva a cada etapa (rascunho local + `PUT /profile` com `onboarding`), permite voltar/editar, pular as etapas 5 e 6 e "Preencher depois". na etapa 5 há o campo opcional de alimentos favoritos. "Criar meu plano" → `POST /onboarding/complete` (todas as respostas vão no corpo; em `__DEV__` o payload é logado) (animação de loading) → aba Treino. Lógica/opções em `src/lib/onboarding.ts`
- `(tabs)/index` — Início: treino de hoje + resumo nutricional do dia
- `(tabs)/workout` — séries, carga/reps, descanso com vibração, finalizar treino
- `(tabs)/nutrition` — dia (navegação por data), card da meta de calorias (calculada pelo perfil + treinos do dia; "Ajustar" define meta manual), resumo kcal/macros × meta, 5 refeições (Café, Lanche manhã, Almoço, Lanche tarde, Jantar) com alimentos, "+", "★ Salvar como favorita" e "Favoritas" (registra tudo de uma vez), remover alimento, botão Foto → calorias
- `food/search` — busca com debounce (350 ms) em `GET /nutrition/foods?q=` com o termo destacado nos resultados; sem texto mostra em destaque os usados recentemente; ícone de código de barras; modo `pick` devolve o alimento à tela anterior
- `food/barcode` — leitor de código de barras (expo-camera: EAN-13/8, UPC) ou digitação manual → `GET /nutrition/foods/barcode/:code`; produtos já vistos são achados offline
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
- `expo-image-picker` e `expo-camera` são módulos nativos novos: precisam de APK novo (`eas build`)
- Favoritas: criar/excluir exige internet; aplicar funciona offline (entra na fila). A lista fica salva no aparelho
- Itens salvos offline por uma versão antiga do app com tipo `snack` ainda são aceitos pela API
- API precisa estar acessível pela internet (deploy Railway ou túnel) para uso fora de casa
- Testar em aparelho: modo avião, fechar/reabrir, finalizar offline e sincronizar
