# STATUS — mobile

- Estado: app do aluno (Expo SDK 58 + expo-router) com login/cadastro, Home, Treino, Progresso, Perfil e Nutrição. Typecheck e bundle Android OK; ainda não testado em celular físico.
- Rodar: `npx expo start` com `EXPO_PUBLIC_API_URL` apontando para a API (celular físico: IP do PC na rede).

## Telas
- `(auth)/login`, `(auth)/register` (cadastro sempre como `student`)
- `onboarding` — questionário de 7 etapas com barra de progresso (dados pessoais, objetivo, nível, rotina, alimentação, saúde, resumo). Abre sozinho após o login quando `GET /profile` devolve `onboardingNeeded` (só `student`). Salva a cada etapa (rascunho local + `PUT /profile` com `onboarding`), permite voltar/editar, pular as etapas 5 e 6 e "Preencher depois". na etapa 5 há o campo opcional de alimentos favoritos. "Criar meu plano" → `POST /onboarding/complete` (todas as respostas vão no corpo; em `__DEV__` o payload é logado) (animação de loading) → aba Treino. Lógica/opções em `src/lib/onboarding.ts`
- `(tabs)/index` — Início: treino de hoje + resumo nutricional do dia
- `(tabs)/workout` — séries, carga/reps, descanso com vibração, finalizar treino
- `(tabs)/nutrition` — dia (navegação por data), card da meta de calorias (calculada pelo perfil + treinos do dia; "Ajustar" define meta manual), resumo kcal/macros × meta, 5 refeições (Café, Lanche manhã, Almoço, Lanche tarde, Jantar) com alimentos, "+", "★ Salvar como favorita" e "Favoritas" (registra tudo de uma vez), remover alimento, botão Foto → calorias
- Nomes de alimentos aparecem como nome de cardápio (`displayName` da API, via `foodLabel`) em busca, diário, foto, favoritas e quantidade
- Início: card **Hidratação** (`components/water-widget.tsx`, lógica em `lib/water.ts`): copo animado, X ml de Y ml + %, barra vermelha (< 50%) / amarela (50–80%) / verde (> 80%), botões +150/+250/+500 ml e "Desfazer último". Meta 2 L (2,5 L para quem declarou mais de 2 L). Todo gole entra primeiro numa fila local (com `clientId`) e sobe em seguida: offline o total é servidor + fila; ao voltar a internet a fila sobe sem duplicar. Desfazer um registro já enviado exige internet. O total zera sozinho na virada do dia (cache por dia + temporizador até a meia-noite)
- `settings/notifications` — lembretes locais (expo-notifications, agendados no aparelho; sem servidor). Acesso pelo sino na Início e por "Notificações e lembretes" no Perfil. Liga/desliga treino, refeições e hidratação; horário do treino com seletor − / + (hora e 5 min). Botão de teste (5 s). Lógica em `src/lib/notifications.ts`:
  - Treino: um lembrete semanal por dia COM treino no plano ativo (dia de descanso não notifica), "Você tem X séries…" (X = soma das séries do dia); padrão 07:00. O plano vem da API ou do cache
  - Refeições: 07:30, 10:00, 12:30, 15:30 e 19:00 (fixos, não seguem o `time_suggestion` do plano alimentar)
  - Água (pelo consumo real do widget): 08, 10, 12, 14, 16, 18 e 20h como avisos únicos de hoje + 2 dias seguintes, reagendados a cada gole registrado e a cada abertura. Passou de 80% da meta: nenhum aviso naquele dia; às 16h com menos de 50%: "Você bebeu pouca água hoje! 💧". Se o app não for aberto por 3 dias, os avisos de água acabam até a próxima abertura
  - Permissão pedida na 1ª abertura (uma vez); tudo é reagendado ao abrir o app, ao voltar para ele e ao mudar as preferências; logout cancela os lembretes
  - Módulo nativo novo: precisa de APK novo (`eas build`); sem o módulo vira no-op
- `food/search` — busca com debounce (350 ms) em `GET /nutrition/foods?q=` com o termo destacado nos resultados; sem texto mostra em destaque os usados recentemente; ícone de código de barras; modo `pick` devolve o alimento à tela anterior
- `food/barcode` — leitor de código de barras (expo-camera: EAN-13/8, UPC; só leituras de 8–14 dígitos). Se a consulta falha (produto não encontrado, sem rede) a câmera PARA e mostra "Ler outro código" / "Buscar pelo nome" (antes relia o mesmo código em loop). Sem permissão definitiva, botão para abrir as configurações; erro ao abrir a câmera cai na digitação manual. Também aceita digitação manual → `GET /nutrition/foods/barcode/:code`; produtos já vistos são achados offline
- `food/quantity` — gramas ou porção caseira, prévia de kcal/macros em tempo real, escolha da refeição, salvar (`POST /nutrition/logs`)
- `food/photo` — câmera/galeria (expo-image-picker, qualidade 0,6, `base64: true`). Fluxo: tirar/escolher a foto só a exibe → campo opcional "Ingredientes principais" (máx. 200 caracteres, placeholder "frango, arroz, feijão...", chips frango/carne bovina/ovo/arroz/feijão/batata/pão/macarrão que somam/tiram do campo) → botão verde "Analisar foto" → `POST /nutrition/recognize` com JSON `{imageBase64, mimeType, hints?}` (o envio de Blob via fetch chegava vazio no React Native, por isso base64). Loading "Identificando alimentos..." (+ "Isso pode levar alguns segundos..." após 10 s); erro em vermelho com "Tentar novamente" (reenvia a mesma foto, os ingredientes continuam editáveis). Depois confirma/ajusta gramas, troca o alimento (candidatos TACO ou busca) e salva com `recognitionSource: 'photo_ai'`. Mudanças só de JavaScript (não exigem APK novo além do já pendente)

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
