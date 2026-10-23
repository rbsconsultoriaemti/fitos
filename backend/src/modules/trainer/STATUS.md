# Módulo trainer (painel do professor)

## Pronto
- `GET /trainer/students` (role `trainer`): alunos com vínculo ativo em `trainer_student`, em ordem alfabética, com
  `todayStatus` (`trained` | `pending` | `rest` | `no_plan`), `streak`, `onStreak`, `lastWorkoutDate` e `summary`
  (`total`, `trainedToday`, `onStreak`, `streakMin`).
- `GET /trainer/students/:id`: dados (nome, objetivo, nível, idade, peso, altura, IMC), plano ativo completo, últimos
  7 treinos (séries feitas/prescritas, aderência %, esforço percebido) e aderência semanal (8 semanas). Sem vínculo ativo => 404.
- `POST /trainer/students/:id/suggest-plan`: rascunho de treino pela IA a partir do perfil/questionário do aluno (reaproveita `generatePlans`; o plano alimentar gerado é descartado). NÃO grava nada; exige vínculo ativo (404), perfil com nascimento/sexo/altura/peso (400), 1 chamada a cada 30 s por professor (429). Envio: `POST /workout/plans` com `studentId` (rascunho) + `/approve`.
- Regras puras em `trainer.logic.ts`.

## Regras definidas
- Treinou hoje = existe `workout_logs` no dia (fuso `config.timezone`). Pendente = dia com treino no plano ativo e sem registro.
- "Em sequência" = `STREAK_MIN` (3) treinos prescritos seguidos; descanso não quebra; hoje sem treino ainda não quebra.
- Aderência semanal = dias de treino feitos ÷ prescritos (semana seg–dom), só a partir da criação do plano e até hoje.
- Aderência do treino = séries feitas ÷ séries prescritas do dia (máx. 100%).

## Pendente
- Professor ver só planos que ele prescreveu: hoje o plano ativo mostrado é o mais recente do aluno, de qualquer origem.
- Perfil/aba "Perfil" do professor ainda reaproveita a tela do aluno; falta uma versão própria.
- Teste: `npm run test:trainer`.
