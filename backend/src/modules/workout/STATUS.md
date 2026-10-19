# STATUS — módulo workout

- Estado: exercícios, planos (prescrição professor → aluno), logs de execução implementados e testados com smoke test (Postgres local). Sem testes automatizados.
- Migration: `1700000000008_create-workout.sql`

## Endpoints (`/workout`, todos exigem login)
Exercícios (catálogo compartilhado)
- `POST /exercises` — `trainer | admin`; nome único (case-insensitive) → 409 se repetido
- `GET /exercises?q=&muscleGroup=` · `GET /exercises/:id`

Planos
- `POST /plans` — professor: `studentId` obrigatório + vínculo ativo em `trainer_student`; nasce `draft`, `source='trainer'`. Aluno: plano próprio, nasce `active`, `source='self'`
- `GET /plans?studentId=&status=` — aluno vê os próprios (rascunhos do professor ficam ocultos); professor vê os que prescreveu para alunos com vínculo ativo
- `GET /plans/:id` — plano com dias, séries e exercícios
- `PUT /plans/:id` — edita rascunho (substitui dias/séries); só o professor que prescreveu; plano ativo → 409
- `POST /plans/:id/approve` — `draft → active`; só o prescritor com vínculo ativo; é aqui que o aluno passa a receber o plano
- `POST /plans/:id/archive` — prescritor, ou aluno dono de plano `self`

Logs
- `POST /logs` — só aluno; plano próprio e `active`; `dayId` e `setId`s precisam pertencer ao plano/dia
- `GET /logs?studentId=&planId=` · `GET /logs/:id` — devolve prescrito vs executado por série. Professor só com vínculo ativo

## Decisões
- Estados do plano: `draft | active | archived`. Plano ativo é imutável (logs referenciam as séries); para mudar, arquivar e criar outro.
- `workout_sets.reps` é TEXT validado por regex (`"10"` ou faixa `"8-12"`); `set_logs.reps_done` é inteiro.
- `day_of_week` 1=segunda … 7=domingo, um dia por plano por dia da semana. `order` das séries = posição no array enviado.
- Sem acesso → 404 (não revela existência). Falta de vínculo ao prescrever → 403.
- Só o papel `trainer` prescreve musculação (admin só cadastra exercícios).

## Pendente
- Rascunho gerado por IA (`source='ai'`): serviço de IA sugere → professor revisa → aprova (a tabela e o status já suportam)
- Aderência (logs executados vs dias prescritos por semana) para o professor — falta um início do plano (`activated_at`) para calcular
- Editar/remover exercícios (hoje só criar/listar; sem `created_by` no modelo)
- Seed do catálogo de exercícios
- Periodização (semanas com cargas progressivas) — hoje o plano é uma semana-tipo repetida
- Paginação em listagens (limites fixos 100/200)
- Testes automatizados
