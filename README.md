# FitOS

Plataforma mobile que conecta alunos a profissionais de saúde e performance. Contexto completo em [CLAUDE.md](CLAUDE.md).

## Estrutura

- `backend/` — API Node.js + TypeScript (Express)
- `ai-service/` — microserviço Python + FastAPI (foto → calorias com Claude Vision; Dockerfile)
- `mobile/` — React Native + Expo (app do aluno e do professor)

Produção: containers Docker (API e ai-service) atrás do Traefik numa VPS; ver [DEPLOY_VPS.md](DEPLOY_VPS.md). Estado e fila de tarefas em [PROXIMOS_PASSOS.md](PROXIMOS_PASSOS.md).

## Pré-requisitos

- Node.js 20+
- PostgreSQL 14+ (usa `gen_random_uuid()` nativo; as migrations também usam as extensões `pg_trgm` e `unaccent`)
- Redis (ainda não usado nesta fase)

## Rodando o backend localmente

1. Crie o banco:
   ```bash
   createdb fitos
   # ou: psql -c "CREATE DATABASE fitos;"
   ```
2. Instale e configure:
   ```bash
   cd backend
   npm install
   cp .env.example .env     # Windows: copy .env.example .env
   ```
   Ajuste `DATABASE_URL` no `.env` para o seu Postgres.
3. Rode as migrations:
   ```bash
   npm run migrate:up
   ```
4. Suba a API:
   ```bash
   npm run dev
   ```
5. Teste: `GET http://localhost:3000/health` → `{"status":"ok","db":"up"}`

## Comandos úteis (em `backend/`)

| Comando | O que faz |
|---|---|
| `npm run dev` | API com hot reload |
| `npm run build` / `npm start` | Compila e executa o build |
| `npm run typecheck` | Checagem de tipos |
| `npm run migrate:up` / `migrate:down` | Aplica / reverte migrations |
| `npm run migrate:create -- nome` | Cria nova migration SQL |
| `npm run test:quotas`, `test:onboarding`, `test:trainer`, `test:recognize` … | Testes ponta a ponta (ver `scripts/` e `package.json`; precisam de banco local) |

## Migrations

Ficam em `backend/src/database/migrations/` (SQL puro, via `node-pg-migrate`, seções `-- Up Migration` / `-- Down Migration`). São 19 (de `001_create-users` a `019_food-preferences`): usuários, perfis, assinaturas, convites, vínculos profissional→aluno, musculação, nutrição, onboarding, água, cotas e preferências alimentares. A lista completa está na pasta.
