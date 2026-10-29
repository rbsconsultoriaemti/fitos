# ARQUITETURA

Decisões técnicas detalhadas do FitOS. Resumo do que existe hoje no código (a stack decidida está no CLAUDE.md).

## Componentes
- **Mobile** (`mobile/`): React Native + Expo (expo-router). Fala só com a API do backend. Tem modo offline para treino, água e registros de alimentos (filas locais; ver `mobile/STATUS.md`).
- **Backend** (`backend/`): Node.js + TypeScript (Express), PostgreSQL. Módulos em `src/modules/` (auth, workout, nutrition, onboarding, preferences, profile, quotas, trainer). JWT de acesso + refresh token.
- **ai-service** (`ai-service/`): FastAPI. Hoje só `POST /vision/food-recognition` (Claude Vision), protegido por `X-Service-Token`. O backend o chama; o app não.
- **Claude API direto do backend**: geração do plano de treino e alimentar do onboarding e a sugestão de treino do professor (`onboarding/claude.ts`, `plan-generator.ts`).

## Produção
- VPS com HTTPS: API e ai-service em containers Docker, roteados pelo Traefik; PostgreSQL no host. PM2 e Nginx desativados. Passo a passo em `DEPLOY_VPS.md`.
- `docker-compose.yml` da VPS e Dockerfile da API: não estão neste repositório (não verificado).

## Decisões já implementadas
- Cotas por plano com janela deslizante sobre `usage_quotas.used_at` (sem job de reset); a cota é checada antes da IA e consumida só depois do sucesso (`modules/quotas`).
- `daily_summaries` é derivada, gerada por job (`src/jobs/daily-summaries.ts`).
- Plano do professor tem prioridade sobre planos `self`/`ai` do aluno (`workout_plans.superseded_by`).
- Catálogo de pratos brasileiros reaproveita `foods.source='custom'` (sem migration; `foods_source_check` só aceita `taco`, `custom` e `openfoodfacts`), com `external_id` `br-dish-NNN` e seeds idempotentes. Os valores nutricionais são estimados por IA e precisam de revisão no portal; se o app passar a tratar `custom` como "criado pelo usuário", criar um `source` próprio.
- Redis: previsto, ainda não usado (a trava de requisição simultânea é em memória).

## Planejado (não iniciado)
Corrida, Ciclismo, Psicologia, RevenueCat (assinaturas), armazenamento de fotos no S3.
