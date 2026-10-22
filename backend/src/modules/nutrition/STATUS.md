# STATUS — módulo nutrition

- Estado: banco TACO, plano alimentar, log de comida e reconhecimento por foto (via ai-service) implementados. Testado com smoke test (Postgres local + ai-service real com o provedor de visão substituído por stub). Sem testes automatizados no backend.
- Migrations: `...009_create-nutrition.sql`, `...010_nutrition-search-portions-mealtype.sql` (pg_trgm + unaccent, porções, tipo de refeição), `...014_nutrition-meals-templates-energy.sql` (5 refeições, source `openfoodfacts`, `meal_templates`, `profiles.kcal_target_override`)
- Seeds: `npm run seed:taco` · `npm run seed:portions` · `npm run seed:openfoodfacts [-- --pages N]` · Job: `npm run job:daily-summaries [YYYY-MM-DD]`

## Banco de alimentos (TACO)
- Fonte: TACO 4ª ed. (NEPA/UNICAMP, 2011), via JSON de terceiros (`marcelosanto/tabela_taco`, MIT). `data/taco.json` é a versão enxuta; `data/build-taco.mjs` mostra como foi gerada.
- 590 de 597 alimentos importados (idempotente por `source + external_id`).
- Tratamento de valores: `Tr` (traço) → 0; `NA` → 0 só quando a energia foi medida (óleos/azeites); `*` e vazio = sem dado → alimento ignorado; negativos de arredondamento → 0.
- **Ignorados (sem dados na TACO):** iogurte sabor abacaxi, leite de vaca integral, leite de vaca desnatado UHT, aguardente de cana, sal dietético, sal grosso, coco verde cru. Leite integral/desnatado faz falta: cadastrar como alimento `custom` (nutricionista/admin).
- Colunas extras em `foods` além do CLAUDE.md: `external_id`, `category`, `portions` (jsonb), `name_search` (gerada: sem acento, minúscula, usada na busca).

## Endpoints (`/nutrition`, todos exigem login)
Alimentos
- `GET /foods?q=&category=` — **busca fuzzy** (até 50): ignora acento e caixa, palavras em qualquer ordem, tolera erro de digitação (ex.: `arros cozido`, `FEIJÃO preto`, `grelhado frango peito`). Cada resultado traz `portions`
- `GET /foods/:id`
- `POST /foods` — `nutritionist | admin`; cria alimento `custom` (aceita `portions`)
- `PATCH /foods/:id/portions` — `nutritionist | admin`; define/corrige as porções caseiras de qualquer alimento

Planos alimentares (mesmo fluxo do workout)
- `POST /plans` — nutricionista: `patientId` + vínculo ativo em `nutritionist_patient`; nasce `draft`, `source='nutritionist'`. Aluno: plano próprio, nasce `active`, `source='self'`
- `GET /plans?patientId=&status=` · `GET /plans/:id` (com refeições, alimentos, macros por item e totais do plano)
- `PUT /plans/:id` — edita rascunho; só o prescritor
- Um plano pode ter só metas, sem refeições montadas (`meals` opcional), desde que tenha ao menos uma refeição ou uma meta. É assim que o aluno sem nutricionista define a meta do dia.
- `POST /plans/:id/approve` — `draft → active`; só o nutricionista prescritor com vínculo ativo
- `POST /plans/:id/archive`

Código de barras e produtos industrializados (Open Food Facts, ODbL — manter a atribuição)
- `GET /foods/barcode/:code` — procura em `foods.barcode`; se não achar, consulta o Open Food Facts ao vivo, guarda o produto (`source='openfoodfacts'`) e devolve (404 se não existe ou sem macros completos). 8–14 dígitos
- `npm run seed:openfoodfacts -- --pages N` (padrão 10; 100 produtos/página por popularidade): só entram produtos com código 789/790, nome e kcal/proteína/carb/gordura por 100 g plausíveis (kcal ≈ 4p+4c+9f com tolerância; ≤ 900 kcal; macros ≤ 100 g). Idempotente por código de barras. Pausa de 7 s entre páginas (limite de ~10 buscas/min do OFF); 503 do OFF é repetido sozinho. Em teste local: 3 páginas → 218 produtos
- Na busca (`GET /foods?q=`), alimento da TACO vem antes de produto de marca entre os resultados que casam todas as palavras

Refeições favoritas (`meal_templates`, `items` jsonb `[{foodId, quantityG | portion}]`)
- `POST /templates` `{ name, mealType?, items[] }` · `GET /templates` (com nome/quantidade/macros por item e totais) · `POST /templates/:id/apply` `{ mealType?, loggedAt? }` (registra todos de uma vez; sem `mealType` usa o da favorita, senão 400) · `DELETE /templates/:id`
- Nome único por usuário (409)

Meta de calorias (`energy.service.ts`)
- `GET /energy-target?date=` e `PUT /energy-target { overrideKcal | null }` (800–10000; null volta ao automático). `GET /logs` também devolve `energy` e `targets.kcalSource`
- Cálculo: TMB Mifflin-St Jeor (peso, altura, idade na data, sexo; "outro" usa a média das constantes) × 1,2 + gasto dos treinos do dia. Treino: musculação = 2,5 min por série a MET 5; cardio = MET pelo nome (corrida ≈ 1 kcal/kg/km pela velocidade, bike por faixa de velocidade, caminhada 4, remo 7, elíptico 5) × peso × tempo. `activityFactor` = (base + treino) / TMB
- Precedência da meta de kcal no dia: manual > plano alimentar > calculada. Faltando peso/altura/nascimento/sexo, `missing` lista o que falta
- Não existe `GET /daily-summaries`: o gasto dos treinos é calculado na hora a partir de `workout_logs` (a tabela derivada `daily_summaries` continua só com o job noturno e `workout_kcal_burned` nulo)

Log de comida (estilo Samsung Health)
- `POST /logs` — `{ items: [{ foodId, mealType, quantityG | portion, mealId? }], loggedAt?, recognitionSource: 'manual' | 'photo_ai' }`
  - `mealType` **obrigatório**: `breakfast | morning_snack | lunch | afternoon_snack | dinner` (café, lanche da manhã, almoço, lanche da tarde, jantar). O tipo antigo `snack` ainda é aceito e vira lanche da manhã (antes das 12h) ou da tarde pelo horário (apps antigos / filas offline)
  - quantidade: **ou** `quantityG` **ou** `portion: { label, count = 1 }` (ex.: `{ label: 'fatia', count: 2 }` → 2 × 25 g). `label` precisa existir em `food.portions` (case-insensitive); senão 400 com as opções disponíveis
  - resposta: `entries` na mesma ordem dos itens enviados, com kcal/proteína/carb/gordura calculados
  - `mealId` (opcional) liga o item a uma refeição do plano ativo do próprio usuário
- `PATCH /logs/:id` — edita `quantityG` **ou** `portion`, `mealType`, `loggedAt`; só o dono. Mandar `quantityG` limpa a porção; as macros são recalculadas
- `DELETE /logs/:id` — só o dono
- `GET /logs?date=YYYY-MM-DD&userId=` — resumo do dia (fuso `APP_TIMEZONE`, padrão America/Sao_Paulo):
  - `meals`: as 5 refeições, sempre na ordem café → lanche da manhã → almoço → lanche da tarde → jantar, cada uma com `label` em português, `entries` e `totals`
  - `entries` (todos os itens), `totals` (kcal, proteína, carb, gordura)
  - `targets` e `progress` quando há plano ativo com metas: por macro `{ consumed, target, remaining, percent }` (`remaining` negativo = passou da meta; macro sem meta = `null`). Sem plano: `null`
  - Nutricionista só vê pacientes com vínculo ativo

Reconhecimento por foto
- `POST /recognize` — JSON `{imageBase64, mimeType}` (formato do app; blob via fetch chegava vazio no React Native) ou bytes crus (`Content-Type: image/jpeg|png|webp`), até 8 MB. Teste: `npm run test:recognize`. Backend → ai-service (`X-Service-Token`) → Claude Vision. Devolve, para cada alimento reconhecido, `recognized {name, estimatedGrams, confidence, estimated {kcal, proteinG, carbG, fatG}}` (macros da porção estimados pelo Claude, fallback quando a TACO não casa) + até 5 `candidates` da base. **Não registra nada**: o aluno confirma/corrige e chama `POST /logs` com `recognitionSource: 'photo_ai'`.
- Config: `AI_SERVICE_URL`, `AI_SERVICE_TOKEN`. Sem token → 503 `ai_unavailable`.

## Porções caseiras (`foods.portions`)
- Formato: `[{ "label": "fatia", "grams": 25 }]`. Líquidos: 1 ml ≈ 1 g (copo = 200, xícara = 240).
- `npm run seed:portions` (`seeds/food-portions.sql`, idempotente) preenche 44 alimentos da TACO: pão de forma/francês, ovos, queijo/presunto (fatia), manteiga, óleos/azeite, açúcar, mel, aveia, arroz cozido, refrigerantes/chás/sucos (copo e xícara), café.
- **A TACO não tem medidas caseiras.** Os valores são estimativas usuais (referências de rotulagem da ANVISA e senso comum), não dados oficiais. Ex.: fatia de pão de forma = 25 g (não 30 g). A fonte adequada para completar é a tabela de medidas referidas da POF/IBGE. Alimento sem porção só aceita gramas.

## Job noturno
- `daily_summaries` é derivada; `src/jobs/daily-summaries.ts` recalcula o dia (padrão: ontem) a partir de `food_logs`, idempotente (upsert). `workout_kcal_burned` fica nulo por enquanto.

## Compliance (CLAUDE.md)
- IA é assistente: reconhecimento por foto nunca grava sozinho; a resposta traz `disclaimer`.
- Plano de nutricionista só chega ao paciente após aprovação dele e vínculo ativo (com `consent_version`).

## Pendente
- **Teste real com o Claude** (precisa de `ANTHROPIC_API_KEY`): só testei com stub; ver `ai-service/STATUS.md`
- Armazenar a foto no S3 (`food_logs.photo_url` existe mas fica nulo; sem credenciais AWS ainda)
- Rate limiting / cota por usuário em `/recognize` (cada chamada custa dinheiro)
- Agendar o job noturno (Railway cron) e cobrir mais de um dia / usuários sem log
- Rascunho de dieta por IA (`source='ai'`, Claude API) → nutricionista revisa → aprova
- Porções para o restante da TACO (feijão em concha, frutas em unidade, etc.): importar a POF/IBGE ou revisar com nutricionista
- `recognition.service.ts` ainda usa o casamento simples por palavras; poderia reutilizar a busca fuzzy de `listFoods`
- Alimentos do leite e derivados ausentes na TACO (ver acima); busca por código de barras
- Editar/remover alimentos `custom`
- Testes automatizados
