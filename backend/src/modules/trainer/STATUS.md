# Módulo trainer (painel do professor)

## Pronto
- `GET /trainer/students` (role `trainer`): alunos com vínculo ativo em `trainer_student`, em ordem alfabética, com
  `todayStatus` (`trained` | `pending` | `rest` | `no_plan`), `streak`, `onStreak`, `lastWorkoutDate` e `summary`
  (`total`, `trainedToday`, `onStreak`, `streakMin`).
- `GET /trainer/students/:id`: dados (nome, objetivo, nível, idade, peso, altura, IMC), plano ativo completo, últimos
  7 treinos (séries feitas/prescritas, aderência %, esforço percebido) e aderência semanal (8 semanas). Sem vínculo ativo => 404.
- `POST /trainer/students/:id/suggest-plan`: rascunho de treino pela IA a partir do perfil/questionário do aluno (gerador só de treino `generateWorkout` em `onboarding/plan-generator.ts`: prompt e ferramenta `criar_treino` enxutos, sem alimentação, metas nutricionais nem catálogo de alimentos; validação compartilhada com o onboarding via `buildTraining`). NÃO grava nada; exige vínculo ativo (404), perfil com nascimento/sexo/altura/peso (400), 1 chamada a cada 30 s por professor (429). Envio: `POST /workout/plans` com `studentId` (rascunho) + `/approve`.
- Regras puras em `trainer.logic.ts`.

## Regras definidas
- Treinou hoje = existe `workout_logs` no dia (fuso `config.timezone`). Pendente = dia com treino no plano ativo e sem registro.
- "Em sequência" = `STREAK_MIN` (3) treinos prescritos seguidos; descanso não quebra; hoje sem treino ainda não quebra.
- Aderência semanal = dias de treino feitos ÷ prescritos (semana seg–dom), só a partir da criação do plano e até hoje.
- Aderência do treino = séries feitas ÷ séries prescritas do dia (máx. 100%).

## Prioridade do plano do professor (migration 017, `workout_plans.superseded_by`)
- `POST /workout/plans/:id/approve` (em transação) arquiva todos os planos ativos do aluno — `trainer` anteriores, `self` e `ai` — gravando `superseded_by` = novo plano. O aluno vê só o plano mais recente do professor.
- Arquivar o plano ativo do professor devolve a ativo os planos `self`/`ai` que ele substituiu, se o aluno não tiver outro plano ativo. Planos antigos do professor não voltam.
- Se o aluno criar/gerar outro plano com o do professor ativo, a listagem do aluno e o painel mostram primeiro o do professor (`ORDER BY source='trainer' DESC, created_at DESC`).

## Pendente
- Perfil/aba "Perfil" do professor ainda reaproveita a tela do aluno; falta uma versão própria.
- Teste: `npm run test:trainer`.
