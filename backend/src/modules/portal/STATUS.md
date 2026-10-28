# STATUS — portal (acesso ao portal web)

- Estado: backend do acesso e das rotas `/portal/admin/*` (Usuários e papéis) pronto e testado (`npm run test:admin-users`) (`npm run test:admin-role`, `npm run test:platform-admin`; `tsc` OK). Nenhuma rota de negócio usa ainda os middlewares de permissão (vêm no passo 2/etapa 2 do portal). Migration 020 aplicada só no banco local; na VPS: não verificado.

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

## Usuários e papéis (`admin-users.routes|service|schemas.ts`; migration 021)
Todas atrás de `requireAuth` + `requirePlatformAdmin` (conferido no banco a cada requisição; quem não é administrador recebe 403, sem token 401). Escrita exige `X-Fitos-Portal: 1`.
- `GET /portal/admin/users?q=&page=`: 50 por página; busca por nome ou e-mail com `ILIKE` parametrizado (`%`, `_` e `\` do texto digitado são escapados). Devolve só `id, name, email, role, isActive, isPlatformAdmin, createdAt`; nunca `password_hash` nem tokens.
- `GET /portal/admin/users/:id`: o mesmo mais `profile` básico (peso, altura, objetivo, nível), `lastAccessAt` e `protections` (texto do motivo de cada ação proibida, ou `null`). `lastAccessAt` é uma aproximação: data do refresh token mais recente (login ou renovação), pois o sistema não guarda "último login".
- `PATCH /portal/admin/users/:id` com `{ role?, isActive? }`: `z.strictObject`, então campo extra (`isPlatformAdmin`, `is_platform_admin`...) e `role: 'admin'` dão 400. Papéis aceitos: student, trainer, running_coach, cycling_coach, nutritionist, psychologist. Repetir o valor atual é aceito e não audita.
- `GET /portal/admin/audit?userId=&page=`: somente leitura, com o nome/e-mail do autor.
- **Proteções (409):** não desativar a própria conta (`self_deactivate`), não trocar o próprio papel (`self_role_change`), não desativar o último administrador ativo (`last_platform_admin`; transação com `SELECT ... FOR UPDATE` nos administradores ativos; se após a alteração não restar nenhum, 409 e ROLLBACK, então duas desativações simultâneas nunca zeram a lista). Na prática, quem tenta já é administrador ativo, então a regra do último só dispara em disputa entre dois administradores (testada no serviço, onde a perdedora recebe sempre 409) ou chamada direta ao serviço. `test:admin-users` recusa rodar com NODE_ENV=production ou DATABASE_URL fora de localhost/127.0.0.1 (`test:admin-users-guard` confirma a recusa).
- **Desativar** também revoga os refresh tokens da conta; o acesso some na próxima requisição (JWT lido do banco).
- **Auditoria:** `admin_audit_log (id, actor_id, target_user_id, action, before jsonb, after jsonb, created_at)`; ações `role_change`, `activate`, `deactivate`, `update`. Um gatilho no banco recusa UPDATE e DELETE. Sem chave estrangeira de propósito (o histórico sobrevive à conta); por isso as linhas geradas pelo teste ficam no banco local.
- **O marcador `is_platform_admin` não é editável por nenhuma rota**: só pelo script abaixo.

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
