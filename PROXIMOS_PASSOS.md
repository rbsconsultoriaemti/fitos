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
3j. Perfil > Alimentação: alimentos favoritos editáveis, refeições favoritas editáveis (`PUT /nutrition/templates/:id`, testado no backend; app sem teste no aparelho)
3i. Preferências alimentares (gosto / não gosto / indiferente): backend (migration 019, `preferences/`, `test:preferences`), prompt da IA, ordenação da busca e etapa 6 do onboarding + Perfil > Minhas preferências — escrito e testado no backend; app sem teste no aparelho; IA real não verificada
3h. Visual estilo iOS (tema azul, títulos grandes, divisores) e safe area nas telas de pilha — aplicado no código, `tsc` OK, pendente de verificação no aparelho

## Próximo passo: Portal web (administração e profissionais)

**Etapa 1 (base) pronta no código, aguardando aprovação para a etapa 2:** `web/` (login, guarda de rota, tela Usuários vazia), `/portal/login|refresh|logout|me` no backend com refresh token em cookie httpOnly, `npm run test:admin-role`, Dockerfile e proposta de labels do Traefik (DEPLOY_VPS.md, "Portal /admin (proposta)"). Detalhes em `web/STATUS.md`. Pendente da etapa 1: validar a interface no navegador e o container na VPS; aplicar as labels no compose real.

**Segurança, a fazer:** o `cors()` da API está aberto (`backend/src/app.ts`). O portal usa o mesmo domínio e não precisa de CORS; restringir às origens necessárias (o app mobile nativo não depende de CORS) antes do lançamento. Também faltam limite de tentativas de login e `NODE_ENV=production` confirmado na VPS (cookie `Secure`).

Decisões com o dono do projeto (27/10/2026), que substituem o escopo inicial:

- **Portal para todos.** Qualquer conta ativa entra em `https://fitos.rbsconsulting.com.br/admin`. As telas liberadas dependem do papel e do vínculo: aluno vê os próprios treinos e dieta (visão do aluno no portal entra depois); profissional vê os alunos vinculados a ele; administrador vê os indicadores da empresa. A checagem é feita rota por rota no backend, e o front nunca é a única barreira.
- **Administrador é um marcador, não um papel.** Usar `is_platform_admin` (boolean) em `users`, mantendo `role` com o papel de negócio. Assim a mesma conta treina como aluno e administra a empresa. Quem recebe o marcador é definido internamente, nunca por formulário.
- **Cadastro só pelo app ou por convite.** O portal faz só login. Nenhum cadastro público de conta.
- **Pedido de convite pelo formulário público** para todos os papéis, exceto administrador. Cada papel tem seu modelo de convite (campos exigidos, texto e validade). Profissionais regulados (nutricionista, psicólogo, educador físico) informam o número e o órgão de registro, e o administrador confere antes de liberar o acesso. Alunos entram normalmente por convite de um profissional.
- **Pré-requisitos de segurança antes de abrir o login para todos:** limite de tentativas em `/auth/login` e `/portal/login`, restringir o `cors()` da API e confirmar `NODE_ENV=production` (já confirmado na VPS).
- **Ordem sugerida:** etapa 2 (área administrativa: usuários e papéis, assinaturas e cotas, catálogos, métricas), depois o painel do profissional, depois a tela de pedidos de convite com revisão pelo administrador, e por último a visão do aluno no portal.

**Convites com papéis e validação de profissional — passo 1 (backend) pronto no código, aguardando aprovação; telas no passo 2** (migration 022, `npm run test:invites`):
- `POST/GET /portal/invites`, `POST /portal/invites/:id/revoke`, `GET /portal/invites/token/:token` e `POST /portal/invites/token/:token/accept` (públicas, com limite por IP); `GET /portal/admin/professionals/pending` e `POST /portal/admin/professionals/:id/validate|reject` (só administrador). Detalhes em `backend/src/modules/portal/STATUS.md`.
- Profissional convidado entra `pending`; só o administrador aprova ou rejeita. Quem está pendente ou rejeitado não cria convites e não passa em `requireValidatedProfessional`.
- **Passo 2a (backend) pronto no código, aguardando aprovação** (`npm run test:professional-gate`): (1) o bloqueio de prescrição para profissional pendente ou rejeitado está aplicado (lista de rotas em `backend/src/modules/portal/STATUS.md`); (2) `POST /auth/register` com papel profissional exige conselho e número e cria a conta `pending`; (3) validar e rejeitar só valem para contas `pending` e são finais pela API; (4) o histórico da conta (`GET /portal/admin/audit`) devolve o texto legível de cada ação; (5) o limite por IP respeita `TRUST_PROXY_HOPS` (testado com instâncias reais; falta conferir atrás do Traefik na VPS). Limite de uso em memória: migrar para Redis se houver mais de uma instância da API.
- **Ainda decidido por padrão (me diga se quer outro):** convite criado por administrador fica só em `invite_audit_log`; convite de profissional criado por profissional não cria vínculo com aluno (vínculo segue o fluxo antigo `/invites/generate` + `/invites/accept`).
- **Próximo (passo 2b, telas):** página pública `/admin/convite/:token` (aceitação), tela de convites (criar, listar, revogar), fila de profissionais pendentes com validar/rejeitar, e o aviso de "registro em análise" para profissional pendente (hoje `/portal/me` não informa `validationStatus`).

Escopo da área administrativa (etapa 2):
- ~~**Usuários e papéis**~~ (feito): listar, buscar, ativar/desativar conta e trocar o papel de negócio. O marcador de administrador (`is_platform_admin`) NÃO se concede nem se retira pela tela ou pela API: só pelo script `grant-platform-admin`; a tela o mostra em leitura.
- **Assinaturas e cotas**: plano de cada usuário, status da assinatura e uso das cotas (fotos e planos por IA), usando `GET /quotas` e os dados de `subscriptions`.
- **Catálogos**: exercícios, alimentos e itens da lista de preferências (incluir, editar, ocultar).
- **Métricas de uso**: usuários ativos, fotos reconhecidas, planos gerados e custo estimado da IA.

Tecnologia (decidido): **React + Vite** em `web/`, no mesmo repositório, consumindo a mesma API. Publicado como container estático atrás do Traefik (sem mudar o padrão de deploy da API).

Pontos já resolvidos e pendências:
- ~~Endereço~~ decidido: `https://fitos.rbsconsulting.com.br/admin`, mesmo domínio da API.
- ~~Autenticação~~ feita na etapa 1: login por `/portal/login`, access token em memória, refresh em cookie httpOnly, papel conferido no banco. Essa checagem precisa passar a valer para "conta ativa" e permissão por rota, conforme as decisões acima.
- Endpoints de administração: ainda não existem. Cada rota nova precisa de checagem de papel ou vínculo e de teste automatizado.
- Observação: o portal descrito como "web" que você usava antes não está publicado nesta VPS. Hoje o domínio serve só a API (a raiz responde 404 do Express). Por isso o portal será construído do zero.

## Fazer agora (precisa de você)
- [x] VPS atualizada em 27/10/2026: código em `fe0b595`, migrations 1 a 19 aplicadas, containers da API e do ai-service reconstruídos; health `ok`. Backup do estado atual feito, mas o backup pré-019 não foi feito (a pasta de backup não existia). Antes do próximo deploy, criar `/var/backups/fitos` e fazer o backup antes do `migrate:up`
- [ ] Pendência do deploy: o `docker-compose.yml` e o `backend/Dockerfile` continuam só na VPS (untracked); versionar. A documentação do DEPLOY_VPS.md diz que o `.env` fica na raiz, mas o compose lê `./backend/.env`; corrigir o documento. O Nginx do host (`/etc/nginx/sites-enabled/fitos`) está parado e é um resto da época de PM2; remover a configuração depois de confirmar que nada depende dela
- [ ] APK novo release gerado localmente (`cd C:\fx\mobile\android; .\gradlew.bat assembleRelease`): módulos nativos expo-camera, expo-image-picker e **expo-notifications**, telas novas, tema azul e splash/cor de notificação novas. Sem isso o app instalado mostra nomes antigos e não agenda lembretes
- [ ] Testar em aparelho: foto → calorias (editar, adicionar, contador de cotas), código de barras, widget de água offline/online, notificação de teste (Configurações > Notificações), onboarding completo (agora com a etapa de preferências alimentares) e Perfil > Minhas preferências, painel do professor, e o visual novo (botão "Analisar foto" acima da barra do Android, títulos grandes, divisores)
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
- Preferências alimentares: a lista "Usados recentemente" da busca do app é local e não segue as preferências; avaliar casar os 27 itens sem TACO com o Open Food Facts; conferir com a Claude real se a IA respeita as listas
- Foto no S3 (`food_logs.photo_url` fica nulo)
- Editar a quantidade de item já registrado; histórico de peso e gráficos no Progresso; histórico/gráfico de água
- Notificações: horários das refeições seguem o plano alimentar; lembretes de água param se o app ficar 3 dias sem abrir (considerar push remoto)
- Atribuição do Open Food Facts (ODbL) no app; restringir CORS
- Preencher `workout_kcal_burned` no job noturno; agendar o job (como agendar na VPS Docker: não definido)
- Versionar no repositório o `docker-compose.yml` da VPS (sem segredos; variáveis do `.env`) e o Dockerfile da API, que hoje só existem na VPS (não verificado); `backend/railway.json` é resquício do plano antigo de deploy no Railway
- Rascunho de dieta por IA → nutricionista revisa → aprova (fluxo do CLAUDE.md)

## Próximos módulos (não iniciados)
0. Portal web (administração e profissionais): próximo passo, ver seção acima
0b. Espaço do professor no portal (depois do portal; o painel mobile já existe)
4. Corrida
5. Ciclismo
6. Psicologia
