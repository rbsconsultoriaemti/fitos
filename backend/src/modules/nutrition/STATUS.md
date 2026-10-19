# STATUS — módulo nutrition

- Estado: banco TACO, plano alimentar, log de comida e reconhecimento por foto (via ai-service) implementados. Testado com smoke test (Postgres local + ai-service real com o Gemini substituído por stub). Sem testes automatizados no backend.
- Migration: `1700000000009_create-nutrition.sql` · Seed: `npm run seed:taco` · Job: `npm run job:daily-summaries [YYYY-MM-DD]`

## Banco de alimentos (TACO)
- Fonte: TACO 4ª ed. (NEPA/UNICAMP, 2011), via JSON de terceiros (`marcelosanto/tabela_taco`, MIT). `data/taco.json` é a versão enxuta; `data/build-taco.mjs` mostra como foi gerada.
- 590 de 597 alimentos importados (idempotente por `source + external_id`).
- Tratamento de valores: `Tr` (traço) → 0; `NA` → 0 só quando a energia foi medida (óleos/azeites); `*` e vazio = sem dado → alimento ignorado; negativos de arredondamento → 0.
- **Ignorados (sem dados na TACO):** iogurte sabor abacaxi, leite de vaca integral, leite de vaca desnatado UHT, aguardente de cana, sal dietético, sal grosso, coco verde cru. Leite integral/desnatado faz falta: cadastrar como alimento `custom` (nutricionista/admin).
- Colunas extras em `foods` além do CLAUDE.md: `external_id`, `category`.

## Endpoints (`/nutrition`, todos exigem login)
Alimentos
- `GET /foods?q=&category=` (50 resultados, prefixo primeiro) · `GET /foods/:id`
- `POST /foods` — `nutritionist | admin`; cria alimento `custom`

Planos alimentares (mesmo fluxo do workout)
- `POST /plans` — nutricionista: `patientId` + vínculo ativo em `nutritionist_patient`; nasce `draft`, `source='nutritionist'`. Aluno: plano próprio, nasce `active`, `source='self'`
- `GET /plans?patientId=&status=` · `GET /plans/:id` (com refeições, alimentos, macros por item e totais do plano)
- `PUT /plans/:id` — edita rascunho; só o prescritor
- `POST /plans/:id/approve` — `draft → active`; só o nutricionista prescritor com vínculo ativo
- `POST /plans/:id/archive`

Log de comida
- `POST /logs` — `{ items: [{ foodId, quantityG, mealId? }], loggedAt?, recognitionSource: 'manual' | 'photo_ai' }`; `mealId` só vale para refeição de plano ativo do próprio usuário
- `GET /logs?date=YYYY-MM-DD&userId=` — entradas do dia (fuso `APP_TIMEZONE`, padrão America/Sao_Paulo) + totais + metas do plano ativo. Nutricionista só com vínculo ativo
- `DELETE /logs/:id` — só o dono

Reconhecimento por foto
- `POST /recognize` — corpo = bytes da imagem (`Content-Type: image/jpeg|png|webp`, até 8 MB). Backend → ai-service (`X-Service-Token`) → Gemini Vision. Devolve, para cada alimento reconhecido, `recognized {name, estimatedGrams, confidence}` + até 5 `candidates` da base. **Não registra nada**: o aluno confirma/corrige e chama `POST /logs` com `recognitionSource: 'photo_ai'`.
- Config: `AI_SERVICE_URL`, `AI_SERVICE_TOKEN`. Sem token → 503 `ai_unavailable`.

## Job noturno
- `daily_summaries` é derivada; `src/jobs/daily-summaries.ts` recalcula o dia (padrão: ontem) a partir de `food_logs`, idempotente (upsert). `workout_kcal_burned` fica nulo por enquanto.

## Compliance (CLAUDE.md)
- IA é assistente: reconhecimento por foto nunca grava sozinho; a resposta traz `disclaimer`.
- Plano de nutricionista só chega ao paciente após aprovação dele e vínculo ativo (com `consent_version`).

## Pendente
- **Teste real com o Gemini** (precisa de `GEMINI_API_KEY`): só testei com stub; ver `ai-service/STATUS.md` (confirmar o id do modelo)
- Armazenar a foto no S3 (`food_logs.photo_url` existe mas fica nulo; sem credenciais AWS ainda)
- Rate limiting / cota por usuário em `/recognize` (cada chamada custa dinheiro)
- Agendar o job noturno (Railway cron) e cobrir mais de um dia / usuários sem log
- Rascunho de dieta por IA (`source='ai'`, Claude API) → nutricionista revisa → aprova
- Busca sem acento/tolerante (`unaccent`/`pg_trgm`) e medidas caseiras (colher, concha, fatia)
- Alimentos do leite e derivados ausentes na TACO (ver acima); busca por código de barras
- Editar/remover alimentos `custom`
- Testes automatizados
