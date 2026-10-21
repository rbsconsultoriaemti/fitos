# STATUS — onboarding (backend)

- Estado: implementado e testado ponta a ponta com uma API Anthropic simulada (servidor falso). **A Claude API real ainda não foi chamada** (sem chave no ambiente de desenvolvimento).
- Migration: `...015_onboarding.sql` (`profiles.onboarding` jsonb, `onboarding_step`, `onboarding_completed_at`)

## Fluxo
1. O app grava cada etapa com `PUT /profile` (campos do perfil + `onboarding: { step, answers }`). As respostas somam-se em `profiles.onboarding`; `step` é a etapa de retomada.
2. `GET /profile` devolve `onboarding { step, answers, completedAt }` e `onboardingNeeded`: verdadeiro enquanto não concluído e (faltam nascimento/sexo/altura/peso **ou** o questionário já foi iniciado). Quem preencheu o perfil pela aba Perfil sem iniciar o questionário não é interrompido.
3. `POST /onboarding/complete` (login): valida o perfil + respostas (etapas 5 e 6 têm padrões se puladas), calcula a nutrição, chama a Claude API, grava tudo numa transação e marca `onboarding_completed_at`. Resposta: `{ planId, title, summary, days, nutrition, nutritionApplied }`. Limite de 1 geração por usuário a cada 60 s (429).

## Geração (Claude API direto, sem passar pelo ai-service)
- `claude.ts`: `POST {ANTHROPIC_BASE_URL}/v1/messages` com `tool_choice` forçado (JSON estruturado). Variáveis: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (padrão `claude-opus-4-5`), `ANTHROPIC_BASE_URL` (só testes). Timeout 100 s.
- `plan-generator.ts`: o prompt leva o perfil e o catálogo de exercícios numerado; a IA devolve `ref` do catálogo (nunca UUID). `sanitize` descarta exercícios inexistentes, dias repetidos, ajusta reps/cardio e valida com `updatePlanSchema`; 2 tentativas.
- Plano gravado com `source='ai'`, `status='active'` (o aluno é dono e pode editar; planos `ai` anteriores e ativos são arquivados). `updatePlan`/`archivePlan` aceitam `ai` para o dono.

## Meta calórica e macros (fórmula, não IA) — `nutrition-targets.ts`
- TMB Mifflin-St Jeor × fator (1,2 + 0,06 × horas de treino/semana, máx. 1,55). Ajuste: perder gordura −20% (IMC ≥ 30: −25%; IMC < 20: −10%), ganhar massa +10% (IMC ≥ 28: +5%), prova +5%, demais 0. Menores de 18 e IMC < 18,5 com perda de gordura ficam na manutenção. Piso: 90% da TMB e 1.200 kcal (1.500 homens).
- Proteína 1,4–2,0 g/kg por objetivo (IMC > 30 usa o peso de IMC 27), gordura ≥ 0,9 g/kg e ≥ 20% das kcal, carboidrato = resto.
- Gravado em `diet_plans` (`source='ai'`, ativo, sem refeições). Não é criado se o usuário já tem plano alimentar ativo de nutricionista/próprio; planos `ai` antigos são arquivados. A meta manual (`kcal_target_override`) continua valendo mais.

## Pendências
- Chamar a Claude API de verdade (definir `ANTHROPIC_API_KEY` no `.env` da VPS) e revisar a qualidade dos planos.
- Sem rate limit global/Redis: o limite de 60 s é em memória (um processo).
