# STATUS — módulo workout

- Estado: exercícios (com seed), planos (prescrição profissional → aluno, e plano próprio editável), logs de execução implementados e testados com smoke test (Postgres local). Sem testes automatizados.
- Migration: `1700000000008_create-workout.sql` · Seed: `src/database/seeds/exercises.sql`

## Quem prescreve
- `trainer`, `running_coach` e `cycling_coach` criam e aprovam planos de musculação. Basta **qualquer** vínculo ativo com o aluno: `trainer_student`, `running_coach_athlete` ou `cycling_coach_athlete`.
- O plano prescrito por profissional tem sempre `source='trainer'` (o CHECK da tabela só aceita `ai | trainer | self`), qualquer que seja o papel de quem prescreveu; `prescribed_by` guarda quem foi.
- Esses três papéis também leem os logs dos alunos com vínculo ativo (como o `trainer` já fazia). `POST /exercises` continua só `trainer | admin`.

## Endpoints (`/workout`, todos exigem login)
Exercícios (catálogo compartilhado)
- `POST /exercises` — `trainer | admin`; nome único (case-insensitive) → 409 se repetido
- `GET /exercises?q=&muscleGroup=` · `GET /exercises/:id`

Planos
- `POST /plans` — profissional: `studentId` obrigatório + vínculo ativo; nasce `draft`, `source='trainer'`. Aluno: plano próprio, nasce `active`, `source='self'`
- `GET /plans?studentId=&status=` — aluno vê os próprios (rascunhos de profissional ficam ocultos); profissional vê os que prescreveu para alunos com vínculo ativo
- `GET /plans/:id` — plano com dias, séries e exercícios
- `PUT /plans/:id` — ver "Regras de edição"
- `POST /plans/:id/approve` — `draft → active`; só o prescritor com vínculo ativo; é aqui que o aluno passa a receber o plano
- `POST /plans/:id/archive` — prescritor, ou aluno dono de plano `self`

Logs
- `POST /logs` — só aluno; plano próprio e `active`; `dayId` e `setId`s precisam pertencer ao plano/dia
- `GET /logs?studentId=&planId=` · `GET /logs/:id` — prescrito vs executado por série. Profissional só com vínculo ativo

## Regras de edição (`PUT /plans/:id`)
- `source='trainer'` (e `ai`): só o prescritor, só enquanto `draft` (reescreve o plano inteiro). Depois de aprovado é imutável → 409 `plan_not_draft`.
- `source='self'`: o dono edita a qualquer momento, inclusive `active`. Só `archived` é recusado (409).
- Edição de plano `self` é feita **no lugar**, para não perder o histórico (as FKs `workout_days → workout_logs` e `workout_sets → set_logs` são `ON DELETE CASCADE`):
  - dias são casados por `dayOfWeek`; séries por `id` (campo opcional em cada série; sem `id` = série nova);
  - série com `id` mantém o exercício: trocar → 400 `exercise_change` (remova a série e adicione outra);
  - **remover** dia ou série que já tem execuções registradas → 409 `has_history`. Dia/série sem execuções pode ser removido;
  - editar carga/reps/descanso/ordem de série já executada é permitido; o log passa a mostrar a prescrição atualizada.

## Seed de exercícios
- 41 exercícios: peito, costas, ombros, bíceps, tríceps, pernas, abdômen e funcionais (inclui os pedidos e alguns extras: supino com halteres, panturrilha sentado).
- `category`: `compound | isolation | core | functional`. `muscle_group`: `peito | costas | ombros | bíceps | tríceps | pernas | abdômen | corpo inteiro`. Equipamentos em português.
- Idempotente (`ON CONFLICT (lower(name)) DO NOTHING`). Rodar com o psql do Windows, que não está no PATH:
  `"C:\Program Files\PostgreSQL\17\bin\psql.exe" "<DATABASE_URL>" -f src/database/seeds/exercises.sql`

## Decisões
- Estados do plano: `draft | active | archived`.
- `workout_sets.reps` é TEXT validado por regex (`"10"` ou faixa `"8-12"`); `set_logs.reps_done` é inteiro.
- `day_of_week` 1=segunda … 7=domingo, um dia por plano por dia da semana. `order` das séries = posição no array enviado.
- Sem acesso → 404 (não revela existência). Falta de vínculo ao prescrever → 403.

## Pendente
- Rascunho gerado por IA (`source='ai'`): serviço de IA sugere → profissional revisa → aprova (a tabela e o status já suportam)
- Aderência (logs executados vs dias prescritos por semana) para o professor — falta um início do plano (`activated_at`) para calcular
- Permitir que `running_coach`/`cycling_coach` cadastrem exercícios (hoje só `trainer | admin`)
- Editar/remover exercícios (hoje só criar/listar; sem `created_by` no modelo)
- Remover série/dia com histórico num plano `self` (hoje 409): exigiria preservar o histórico, por exemplo trocando as FKs de cascata por `SET NULL`
- Periodização (semanas com cargas progressivas) — hoje o plano é uma semana-tipo repetida
- Paginação em listagens (limites fixos 100/200)
- Testes automatizados
