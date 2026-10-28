# STATUS — portal (acesso ao portal web)

- Estado: backend do acesso pronto e testado (`npm run test:admin-role`, `npm run test:platform-admin`; `tsc` OK). Nenhuma rota de negócio usa ainda os middlewares de permissão (vêm no passo 2/etapa 2 do portal). Migration 020 aplicada só no banco local; na VPS: não verificado.

## Regra de acesso (decidida)
- O portal aceita **qualquer conta ativa**. O que cada pessoa pode fazer é decidido **rota por rota**, no backend, consultando o banco a cada requisição (o JWT dura 15 min e leva o papel de quando foi emitido).
- `users.role` continua sendo o papel de negócio (`student | trainer | running_coach | cycling_coach | nutritionist | psychologist | admin`). O administrador da plataforma é outro campo: `users.is_platform_admin` (migration `1700000000020_platform-admin.sql`, `BOOLEAN NOT NULL DEFAULT false`).
- O marcador **nunca** é aceito em cadastro, convite, `PUT /profile` ou qualquer corpo de requisição (os schemas ignoram campos extras; coberto em `test:platform-admin`). Só muda pelo script interno `npm run grant-platform-admin`.
- O papel `admin` antigo NÃO equivale ao marcador: não passa em `requirePlatformAdmin` nem em `requireProfessional`. Ele continua existindo e sendo usado nas rotas listadas abaixo.

## Middlewares (`portal.access.ts`; use depois de `requireAuth`)
- `requirePortalAccess`: conta existe e está ativa (senão 401). Preenche `req.account` e atualiza `req.auth.role` com o papel atual do banco.
- `requirePlatformAdmin`: além disso, exige `is_platform_admin = true` (senão 403).
- `requireProfessional`: papel em `trainer | running_coach | cycling_coach | nutritionist | psychologist`, ou marcador de administrador (senão 403).
- `requireRole(...)` (em `auth/auth.middleware.ts`) segue existindo e lê o papel do JWT; rotas novas do portal devem usar os de cima.

## Rotas
- `POST /portal/login`, `POST /portal/refresh`, `POST /portal/logout`: refresh token em cookie httpOnly (`fitos_portal_rt`, `Path=/portal`, `SameSite=Strict`, `Secure` em produção), cabeçalho `X-Fitos-Portal: 1` obrigatório. Não filtram mais por papel (só conta ativa).
- `GET /portal/me` -> `{ id, name, email, role, isPlatformAdmin }` (somente leitura; nada além disso).

## Script (`backend/scripts/grant-platform-admin.ts`)
- `npm run grant-platform-admin -- --email <e-mail> [--revoke]`. E-mail obrigatório, sem espaços e com `@`; busca sem diferenciar maiúsculas; se não existir, sai com erro e não cria nada. Mostra antes/depois (id, nome, papel, is_active, is_platform_admin) e acrescenta uma linha em `backend/logs/platform-admin.log` (data, e-mail, ação, usuário do sistema; a pasta `logs/` está no `.gitignore`; `PLATFORM_ADMIN_LOG` troca o caminho). Usa `DATABASE_URL`.

## Uso de `role === 'admin'` hoje (não removido nesta etapa)
- `nutrition/nutrition.routes.ts:59,67` — `requireRole('nutritionist', 'admin')`
- `nutrition/nutrition.service.ts:33,221,387` — acesso a dados de qualquer paciente
- `workout/workout.routes.ts:24` — `requireRole('trainer', 'admin')`
- `workout/workout.service.ts:34,148,286` — acesso a dados de qualquer aluno
- Tipos: `auth.repository.ts` (`Role`), `mobile/src/lib/types.ts`, `web/src/api.ts`; enum no banco em `1700000000001_create-users.sql`. Nenhum cadastro público cria `admin` (`registrableRoles`).

## Pendências
- Passo 2: telas de negócio no portal e no app. A checagem antiga `PORTAL_ROLES` do front foi removida (28/10/2026); `test:admin-role` cobre aluno com/sem marcador e conta desativada.
- Decidir o destino do papel `admin` (migrar para o marcador e remover) depois que as rotas acima forem revistas.
- Sem limite de tentativas no login.
