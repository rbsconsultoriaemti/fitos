# STATUS — módulo auth

- Estado: registro, login, JWT e refresh token implementados e testados manualmente (smoke test contra Postgres local)

## Endpoints
- `POST /auth/register` — name, email, password (8–72), role (default `student`; `admin` não é permitido)
- `POST /auth/login`
- `POST /auth/refresh` — rotação: cada refresh token vale uma vez; reuso revoga a família inteira
- `POST /auth/logout` — revoga a família do refresh token enviado
- `GET /auth/me` — requer `Authorization: Bearer <access>`

## Convites (`invites.*.ts`)
- `POST /invites/generate` — requer `trainer | running_coach | cycling_coach | nutritionist | psychologist`; devolve `{ token, link, expiresAt }` (7 dias, `INVITE_TTL_DAYS`; link base em `INVITE_BASE_URL`)
- `POST /invites/accept` — requer login de aluno; body `{ token, consentVersion? }`. O app chama logo após `/auth/register` ou `/auth/login` com o access token recebido
- Tabela de vínculo conforme o papel de quem gerou: `trainer_student`, `running_coach_athlete`, `cycling_coach_athlete`, `nutritionist_patient`, `psychologist_patient` (migrations `...006` e `...007`)
- Convite é de uso único. Token guardado como SHA-256 (o texto puro só aparece na resposta do generate)
- Nutricionista e psicólogo exigem `consentVersion` (LGPD); psicólogo grava `consent_signed_at`, `share_mood_with_trainers` começa `false`
- Vínculo já ativo → 409 e o convite NÃO é consumido; vínculo `ended` é reativado
- Erros: 404 não encontrado, 410 usado/expirado/revogado, 403 papel incompatível, 400 próprio convite/sem consentimento

## Decisões
- Access JWT HS256, 15min, payload `{ sub, role }`. Refresh opaco (48 bytes), só o SHA-256 vai ao banco (`refresh_tokens`), 30 dias.
- bcryptjs (12 rounds); login compara contra hash dummy quando o e-mail não existe (tempo constante).
- Middlewares: `requireAuth`, `requireRole(...roles)` em `auth.middleware.ts`.

## Pendente
- Endpoint público `GET /invites/:token` para o app mostrar quem convidou (e o termo de consentimento) antes do cadastro
- Listar/revogar convites pendentes (sender)
- Texto/versão oficial do termo de consentimento (hoje `consentVersion` é string livre)
- Rate limiting em `/auth/login` e `/auth/register`
- Testes automatizados (hoje só smoke test manual)
- Job de limpeza de `refresh_tokens` expirados
- Validar que profissionais (não-aluno) têm habilitação/registro profissional antes de prescrever (CFN/CFP)
- `JWT_ACCESS_SECRET` forte em produção (config já recusa < 32 chars)
