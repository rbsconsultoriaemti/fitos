# FitOS

Plataforma mobile que conecta alunos a profissionais de saúde e performance. Contexto completo em [CLAUDE.md](CLAUDE.md).

## Estrutura

- `backend/` — API Node.js + TypeScript (Express)
- `ai-service/` — microserviço Python + FastAPI (a construir)
- `mobile/` — React Native + Expo (a construir)

## Pré-requisitos

- Node.js 20+
- PostgreSQL 14+ (usa `gen_random_uuid()` nativo)
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

## Migrations

Ficam em `backend/src/database/migrations/` (SQL puro, via `node-pg-migrate`, seções `-- Up Migration` / `-- Down Migration`). Atuais: `users`, `profiles`, `subscriptions`, `invites`.
