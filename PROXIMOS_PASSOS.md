# PRÓXIMOS PASSOS

## Estado atual (último commit: hints de ingredientes no reconhecimento de foto)

Feito (detalhes nos STATUS.md de cada módulo):
1. ~~Auth (cadastro, login, JWT, convites)~~
2. ~~Musculação (exercícios com imagens, planos ABA/edição/cardio, logs, Progresso)~~
3. ~~Nutrição (TACO + Open Food Facts, 5 refeições, código de barras, favoritas, meta dinâmica, foto → calorias com campo de ingredientes)~~
3b. ~~App mobile do aluno: login, Início, Treino offline, Progresso, Perfil, Nutrição, Onboarding de 7 etapas~~
3c. ~~Onboarding com plano de treino e plano alimentar gerados pela Claude API (logs, validação, 422, `npm run test:onboarding`)~~
3d. ~~Deploy na VPS (Nginx + PM2 + PostgreSQL), ai-service em container~~ — backend em https://fitos.rbsconsulting.com.br com `ANTHROPIC_API_KEY` carregada

## Fazer agora (precisa de você)
- [ ] VPS: `git pull`, `npm ci && npm run build`, `npm run migrate:up` (até a 015), `pm2 restart fitos`; reconstruir o container do ai-service (removeu `temperature`, novo campo `hints`)
- [ ] Gerar APK novo (`npx eas-cli@latest build --platform android --profile preview`): expo-camera, image-picker e onboarding são módulos/telas novos
- [ ] Testar em aparelho: foto → calorias (com e sem ingredientes), código de barras, onboarding completo, modo offline
- [ ] Primeira geração real com a Claude (plano do onboarding e foto): conferir qualidade do prompt em `onboarding/plan-generator.ts` e `ai-service/app/vision.py`, custo e latência
- [ ] Limpar exercícios de teste do banco local ("Supino 562029", "Agachamento 562029")

## Backlog técnico
- Rate limit por usuário em `/nutrition/recognize` e `/onboarding/complete` (hoje em memória só no onboarding; ideal Redis)
- Foto no S3 (`food_logs.photo_url` fica nulo)
- Editar quantidade de item já registrado; histórico de peso e gráficos no Progresso
- Atribuição do Open Food Facts (ODbL) no app; restringir CORS
- Preencher `workout_kcal_burned` no job noturno; agendar o job
- Rascunho de dieta por IA → nutricionista revisa → aprova (fluxo do CLAUDE.md)

## Próximos módulos
4. Corrida
5. Ciclismo
6. Psicologia
