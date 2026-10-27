# PRÓXIMOS PASSOS

## Estado atual (último commit: 436d65d — visual iOS, títulos grandes e divisores nas abas)

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
3e. ~~Deploy na VPS: API e ai-service em containers Docker, roteados pelo Traefik, PostgreSQL no host (PM2 e Nginx desativados; ver DEPLOY_VPS.md)~~
3f. ~~Painel do professor (backend `/trainer/*` + telas + prescrição manual/por IA)~~ — falta testar no aparelho e subir na VPS
3g. Cotas por plano: backend pronto (migration 018); app com contador de fotos (escrito, `tsc` OK, sem teste no aparelho)
3h. Visual estilo iOS (tema azul, títulos grandes, divisores) e safe area nas telas de pilha — aplicado no código, `tsc` OK, pendente de verificação no aparelho

## Fazer agora (precisa de você)
- [ ] VPS (fluxo único em DEPLOY_VPS.md): `cd /var/www/fitos && git pull`; `migrate:up` com a `DATABASE_URL` do DEPLOY_VPS.md para aplicar o que faltar até a **018** (quais já rodaram na VPS: não verificado); `docker compose up -d --build` (reconstrói API e ai-service, que precisa do código sem `temperature` e com `hints`). Sem `pm2`, `npm ci` ou `chown` no host
- [ ] APK novo release gerado localmente (`cd C:\fx\mobile\android; .\gradlew.bat assembleRelease`): módulos nativos expo-camera, expo-image-picker e **expo-notifications**, telas novas, tema azul e splash/cor de notificação novas. Sem isso o app instalado mostra nomes antigos e não agenda lembretes
- [ ] Testar em aparelho: foto → calorias (editar, adicionar, contador de cotas), código de barras, widget de água offline/online, notificação de teste (Configurações > Notificações), onboarding completo, painel do professor, e o visual novo (botão "Analisar foto" acima da barra do Android, títulos grandes, divisores)
- [ ] Primeira geração real com a Claude (onboarding e foto): conferir qualidade do prompt (`onboarding/plan-generator.ts`, `ai-service/app/vision.py`), custo e latência
- [ ] Limpar exercícios de teste do banco local ("Supino 562029", "Agachamento 562029")

## Roadmap — cotas, custo e assinatura (regras de negócio em CLAUDE.md, "Limites por plano")

Limites: **gratuito** = 10 fotos a cada 30 dias + 1 plano de treino por IA a cada 90 dias (janela deslizante); **pago (R$ 19/mês ou R$ 175/ano)** = 20 fotos/dia + novo plano de treino toda semana.

1. [ ] **Trocar o modelo do reconhecimento de foto** de `claude-opus-4-5` para `claude-haiku-5-5` (`ANTHROPIC_MODEL` no ai-service; custo de ~R$ 0,20 para ~R$ 0,02 por foto). Antes de fixar: comparar a qualidade das estimativas de gramas com fotos reais de pratos brasileiros
2. [~] **Controle de cotas por plano** — backend FEITO (migration 018, `quotas.service.ts`, `GET /quotas`, 429 `quota_exceeded`, `npm run test:quotas`). App: contador de fotos e aviso de liberação escritos (`lib/quotas.ts`, `food/photo.tsx`; `tsc` OK, sem teste no aparelho); FALTA avisar no onboarding quando o plano de treino por IA ainda não está liberado (o 429 `quota_exceeded` não é tratado lá)
   - Tabela `usage_quotas` (migration) para rastrear o uso por usuário, recurso (`photo_recognition`, `ai_workout_plan`) e período
   - Middleware que checa a cota ANTES de `POST /nutrition/recognize` e `POST /onboarding/complete` e só consome depois do sucesso (falha da IA não gasta cota)
   - Erro **429** com mensagem amigável e dados do limite (usado, limite, quando renova)
   - App: mostrar quantas fotos restam (no mês no básico, no dia no pago) na tela da foto; avisar quando a geração de plano ainda não está liberada
   - **Janela corrente (decidido)**: períodos contados para trás a partir de agora, não por calendário. Plano de treino: próxima geração liberada em último uso + 3 meses (gratuito) ou + 7 dias (pago). Fotos: usos dos últimos 30 dias (gratuito) ou 24 h (pago); a cota volta quando o uso mais antigo sai da janela. A resposta 429 e o contador do app devem dizer QUANDO libera (data/hora do vencimento do uso mais antigo). Consulta simples sobre `usage_quotas.used_at`, sem job de reset
3. [ ] **Verificar o plano ativo via RevenueCat** antes de liberar a cota paga (webhook + consulta à API; guardar o estado em `subscriptions`; sem confirmação vale a cota do básico)
4. [x] Limite provisório em memória do onboarding substituído pelas cotas (banco)

## Backlog técnico
- Trava de requisição simultânea por usuário (`quotas.middleware.ts`) é em memória; migrar para Redis ao rodar mais de uma instância da API
- Fora das cotas do aluno: `POST /trainer/students/:id/suggest-plan` (cooldown próprio de 30 s do professor, em memória)
- Foto no S3 (`food_logs.photo_url` fica nulo)
- Editar a quantidade de item já registrado; histórico de peso e gráficos no Progresso; histórico/gráfico de água
- Notificações: horários das refeições seguem o plano alimentar; lembretes de água param se o app ficar 3 dias sem abrir (considerar push remoto)
- Atribuição do Open Food Facts (ODbL) no app; restringir CORS
- Preencher `workout_kcal_burned` no job noturno; agendar o job (como agendar na VPS Docker: não definido)
- Versionar no repositório o `docker-compose.yml` da VPS (sem segredos; variáveis do `.env`) e o Dockerfile da API, que hoje só existem na VPS (não verificado); `backend/railway.json` é resquício do plano antigo de deploy no Railway
- Rascunho de dieta por IA → nutricionista revisa → aprova (fluxo do CLAUDE.md)

## Próximos módulos (não iniciados)
4. Corrida
5. Ciclismo
6. Psicologia
