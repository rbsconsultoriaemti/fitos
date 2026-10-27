# STATUS — quotas (backend)

- Estado: implementado e testado (`npm run test:quotas`; o consumo no sucesso do plano de treino é coberto por `npm run test:onboarding`).
- Migration: `...018_usage-quotas.sql` (`usage_quotas`: id, user_id, kind, used_at, ref_id; índice em `(user_id, kind, used_at)`).

## Regras (CLAUDE.md, "Limites por plano")
| Recurso (`kind`) | Gratuito | Pago |
|---|---|---|
| `photo_recognition` | 10 nos últimos 30 dias | 20 nas últimas 24 h |
| `ai_workout_plan` | 1 nos últimos 90 dias | 1 nos últimos 7 dias |

- Janela deslizante: conta `usage_quotas.used_at` dentro da janela; sem job de reset.
- Pago = `subscriptions` com `plan='premium'`, `status='active'` e (`expires_at` nulo ou futuro). `trialing`, `past_due`, cancelada ou vencida valem como gratuito. A verificação via RevenueCat (webhook) ainda não existe.
- `resetsAt`: com a cota esgotada, quando abre uma vaga (o `(usado − limite + 1)`º uso mais antigo + janela); com vaga sobrando, quando o uso mais antigo sai da janela; `null` sem uso.

## Código
- `quotas.service.ts`: `getQuotaStatus(userId, kind)` -> `{ kind, plan, limit, used, remaining, windowMs, resetsAt }`, `consumeQuota(userId, kind, refId, db?)` (aceita um client de transação), `assertQuota`, `releaseText`/`exceededMessage` (mensagem PT-BR: "libera às 14h", "amanhã às 6h", "em 12 dias"; horário no fuso `APP_TIMEZONE`).
- `quotas.middleware.ts`: `requireQuota(kind)` checa ANTES da rota (429 `quota_exceeded`) e não consome; também permite só uma requisição por usuário e recurso por vez (429 `request_in_progress`; em memória).
- `GET /quotas` (login): `{ photo_recognition: QuotaStatus, ai_workout_plan: QuotaStatus }`, para o contador do app.
- 429: `{ error: 'quota_exceeded', message, resetsAt, limit, used, plan }` (campos extras na raiz via `AppError.extra`).

## Onde se aplica
- `POST /nutrition/recognize`: consome depois que a IA respondeu com sucesso.
- `POST /onboarding/complete`: consome dentro da transação que grava o plano.
- `POST /trainer/students/:id/suggest-plan` fica FORA das cotas do aluno (tem só o cooldown próprio do professor).

## Pendências
- App: contador de fotos restantes e aviso de plano ainda não liberado (consumir `GET /quotas` e tratar o 429 `quota_exceeded`).
- RevenueCat (webhook + consulta) para confirmar a assinatura.
- Trava de requisição simultânea em memória: migrar para Redis se houver mais de uma instância.
