# PRÓXIMOS PASSOS

## Estado atual (último commit: edição inline na foto, widget de água, notificações)

Feito (detalhes nos STATUS.md de cada módulo):
1. ~~Auth (cadastro, login, JWT, convites)~~
2. ~~Musculação (exercícios com imagens, planos ABA/edição/cardio, logs, Progresso)~~
3. ~~Nutrição: TACO + Open Food Facts, 5 refeições, código de barras, favoritas, meta dinâmica~~
   - Foto → calorias: envio em base64, ingredientes opcionais (`hints`), edição inline (gramas, trocar alimento, remover, **+ Adicionar alimento**, título acompanha o alimento escolhido)
   - Nomes de cardápio (`displayName`) em todas as telas e busca priorizando alimentos preparados
   - Água: card na Início (copo animado, barra por faixa, +150/+250/+500 ml), `water_logs` (migration 016), fila offline sem duplicar
3b. ~~App mobile do aluno: login, Início, Treino offline, Progresso, Perfil, Nutrição, Onboarding de 7 etapas~~
3c. ~~Onboarding com plano de treino e plano alimentar gerados pela Claude API~~
3d. ~~Notificações locais: treino (só dias com treino), 5 refeições, água pelo consumo real (para em 80% da meta; urgente às 16h abaixo de 50%)~~, com tela de configurações
3e. ~~Deploy na VPS (Nginx + PM2 + PostgreSQL), ai-service em container~~

## Fazer agora (precisa de você)
- [ ] VPS: `git pull`, `npm ci && npm run build`, `npm run migrate:up` (até a **016**), `pm2 restart fitos`; reconstruir o container do ai-service (sem `temperature`, com `hints`)
- [ ] APK novo (`npx eas-cli@latest build --platform android --profile preview`): módulos nativos expo-camera, expo-image-picker e **expo-notifications** + telas novas. Sem isso o app instalado mostra nomes antigos e não agenda lembretes
- [ ] Testar em aparelho: foto → calorias (editar, adicionar), código de barras, widget de água offline/online, notificação de teste (Configurações > Notificações), onboarding completo
- [ ] Primeira geração real com a Claude (onboarding e foto): conferir qualidade do prompt (`onboarding/plan-generator.ts`, `ai-service/app/vision.py`), custo e latência
- [ ] Limpar exercícios de teste do banco local ("Supino 562029", "Agachamento 562029")

## Roadmap — cotas, custo e assinatura (regras de negócio em CLAUDE.md, "Limites por plano")

Limites: **gratuito** = 10 fotos/mês + 1 plano de treino por IA a cada 3 meses; **pago (R$ 19/mês ou R$ 175/ano)** = 20 fotos/dia + novo plano de treino toda semana.

1. [ ] **Trocar o modelo do reconhecimento de foto** de `claude-opus-4-5` para `claude-haiku-5-5` (`ANTHROPIC_MODEL` no ai-service; custo de ~R$ 0,20 para ~R$ 0,02 por foto). Antes de fixar: comparar a qualidade das estimativas de gramas com fotos reais de pratos brasileiros
2. [ ] **Controle de cotas por plano**
   - Tabela `usage_quotas` (migration) para rastrear o uso por usuário, recurso (`photo_recognition`, `ai_workout_plan`) e período
   - Middleware que checa a cota ANTES de `POST /nutrition/recognize` e `POST /onboarding/complete` e só consome depois do sucesso (falha da IA não gasta cota)
   - Erro **429** com mensagem amigável e dados do limite (usado, limite, quando renova)
   - App: mostrar quantas fotos restam (no mês no básico, no dia no pago) na tela da foto; avisar quando a geração de plano ainda não está liberada
   - **Janela corrente (decidido)**: períodos contados para trás a partir de agora, não por calendário. Plano de treino: próxima geração liberada em último uso + 3 meses (gratuito) ou + 7 dias (pago). Fotos: usos dos últimos 30 dias (gratuito) ou 24 h (pago); a cota volta quando o uso mais antigo sai da janela. A resposta 429 e o contador do app devem dizer QUANDO libera (data/hora do vencimento do uso mais antigo). Consulta simples sobre `usage_quotas.used_at`, sem job de reset
3. [ ] **Verificar o plano ativo via RevenueCat** antes de liberar a cota paga (webhook + consulta à API; guardar o estado em `subscriptions`; sem confirmação vale a cota do básico)
4. [ ] Substituir o limite provisório em memória do onboarding (1 geração/60 s) por essas cotas (Redis ou banco)

## Backlog técnico
- Rate limit por usuário em `/nutrition/recognize` e `/onboarding/complete` (hoje só em memória no onboarding; ideal Redis)
- Foto no S3 (`food_logs.photo_url` fica nulo)
- Editar a quantidade de item já registrado; histórico de peso e gráficos no Progresso; histórico/gráfico de água
- Notificações: horários das refeições seguem o plano alimentar; lembretes de água param se o app ficar 3 dias sem abrir (considerar push remoto)
- Atribuição do Open Food Facts (ODbL) no app; restringir CORS
- Preencher `workout_kcal_burned` no job noturno; agendar o job
- Rascunho de dieta por IA → nutricionista revisa → aprova (fluxo do CLAUDE.md)

## Próximos módulos
4. Corrida
5. Ciclismo
6. Psicologia
