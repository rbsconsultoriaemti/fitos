# STATUS — onboarding (backend)

- Estado: implementado e testado ponta a ponta com uma API Anthropic simulada (servidor falso). **A Claude API real ainda não foi chamada** (sem chave no ambiente de desenvolvimento).
- Teste: `npm run test:onboarding` (em `backend/scripts/`) cadastra um usuário, preenche as 6 etapas com a lógica do app, testa respostas inválidas da IA (422) e a conclusão, imprime treino + plano alimentar e apaga o usuário. Usa a Claude real se houver `ANTHROPIC_API_KEY`; senão, um servidor Anthropic simulado (conteúdo montado pelo script, não por IA).
- Migration: `...015_onboarding.sql` (`profiles.onboarding` jsonb, `onboarding_step`, `onboarding_completed_at`)

## Fluxo
1. O app grava cada etapa com `PUT /profile` (campos do perfil + `onboarding: { step, answers }`). As respostas somam-se em `profiles.onboarding`; `step` é a etapa de retomada.
2. `GET /profile` devolve `onboarding { step, answers, completedAt }` e `onboardingNeeded`: verdadeiro enquanto não concluído e (faltam nascimento/sexo/altura/peso **ou** o questionário já foi iniciado). Quem preencheu o perfil pela aba Perfil sem iniciar o questionário não é interrompido.
3. `POST /onboarding/complete` (login): o corpo é opcional (mesmo formato do `PUT /profile` + `onboarding.answers`; o app manda tudo aqui) e é gravado antes. Depois lê o perfil, calcula a nutrição, monta o contexto de alimentos, chama a Claude API, grava tudo numa transação e marca `onboarding_completed_at`. Resposta: `{ planId, title, summary, days, nutrition, nutritionApplied, mealPlan, defaultsUsed }`. Protegido pela cota `ai_workout_plan` (gratuito: 1 a cada 90 dias; pago: 1 a cada 7 dias; 429 `quota_exceeded` com `resetsAt`). A cota é consumida dentro da transação que grava o plano, então falha da IA/422 não gasta cota. O limite provisório em memória (1/60 s) foi removido; fica só a trava de uma requisição por vez por usuário.
   - Dados biométricos (nascimento, sexo, altura, peso) são obrigatórios (400 `onboarding_incomplete` com `details.missing`). Qualquer outra resposta ausente recebe valor padrão (objetivo manter, 3 dias, 60 min, academia, musculação, 4 refeições…), listado em `defaultsUsed`, no log (WARN) e no prompt.
   - Resposta da IA fora do formato (ou cortada por `max_tokens`), depois de 2 tentativas: **422 `ai_invalid_response`** com `details.issues` (campo + problema). Nada é gravado.

## Logs (`onboarding.log.ts`)
- Prefixo `[onboarding <id> user=<8 chars>]`. Em desenvolvimento (`NODE_ENV != production`): payload recebido, perfil lido do banco, prompt completo e resposta bruta da Claude antes do parse. Em produção esses quatro NÃO são logados (dados de saúde / LGPD); ficam só metadados, avisos e erros (com a resposta truncada em 1.500–2.500 caracteres).
- No app, `__DEV__` loga cada etapa enviada (e se o servidor guardou tudo) e o payload do POST.

## Geração (Claude API direto, sem passar pelo ai-service)
- `claude.ts`: `POST {ANTHROPIC_BASE_URL}/v1/messages` com `tool_choice` forçado (JSON estruturado). Variáveis: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (padrão `claude-opus-4-5`), `ANTHROPIC_BASE_URL` (só testes). Timeout 100 s.
- `plan-generator.ts`: o prompt leva perfil (peso, altura, idade, sexo, IMC), objetivo, nível, dias/tempo/local/modalidades, restrições, lesões, meta calórica e macros, **alimentos favoritos com valores da TACO**, **os 10 alimentos mais registrados** e um catálogo numerado de alimentos e de exercícios; a IA devolve `ref`/`foodRef` (nunca UUID). A resposta é validada campo a campo (zod) e depois item a item (referências inexistentes e dias repetidos são descartados com WARN); 2 tentativas.
- `food-context.ts`: favoritos (texto livre da etapa 5) são casados com a TACO (apelidos para arroz, feijão, frango, ovo, batata doce…, senão busca por palavras preferindo versão cozida/grelhada); base de ~30 alimentos comuns para a IA completar.
- Plano alimentar de um dia: a IA escolhe alimentos e gramas; o servidor **reescala as quantidades para a soma bater com a meta de kcal** (a IA erra a conta) e grava em `diet_plans`/`meals`/`meal_foods`. Os macros do dia saem do que os alimentos realmente têm, então podem divergir da meta de macros.
- Plano gravado com `source='ai'`, `status='active'` (o aluno é dono e pode editar; planos `ai` anteriores e ativos são arquivados). `updatePlan`/`archivePlan` aceitam `ai` para o dono.

## Meta calórica e macros (fórmula, não IA) — `nutrition-targets.ts`
- TMB Mifflin-St Jeor × fator (1,2 + 0,06 × horas de treino/semana, máx. 1,55). Ajuste: perder gordura −20% (IMC ≥ 30: −25%; IMC < 20: −10%), ganhar massa +10% (IMC ≥ 28: +5%), prova +5%, demais 0. Menores de 18 e IMC < 18,5 com perda de gordura ficam na manutenção. Piso: 90% da TMB e 1.200 kcal (1.500 homens).
- Proteína 1,4–2,0 g/kg por objetivo (IMC > 30 usa o peso de IMC 27), gordura ≥ 0,9 g/kg e ≥ 20% das kcal, carboidrato = resto.
- Gravado em `diet_plans` (`source='ai'`, ativo, sem refeições). Não é criado se o usuário já tem plano alimentar ativo de nutricionista/próprio; planos `ai` antigos são arquivados. A meta manual (`kcal_target_override`) continua valendo mais.

## Pendências
- Chamar a Claude API de verdade (definir `ANTHROPIC_API_KEY` no `.env` da VPS) e revisar a qualidade dos planos.
- A trava de requisição simultânea (`quotas.middleware.ts`) é em memória (um processo); com mais de uma instância da API, migrar para Redis/advisory lock.
