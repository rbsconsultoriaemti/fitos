# STATUS — web (portal de administração e profissionais)

- Estado: **etapa 1 (base) pronta no código**; telas de negócio (etapa 2) NÃO começaram. `npm run build` e `tsc --noEmit` OK; login, cookie e refresh conferidos com `curl` pelo proxy do Vite. NÃO verificado: a interface num navegador, o Dockerfile (sem Docker nesta máquina) e o roteamento no Traefik.
- Stack: React 19 + Vite 7 + TypeScript + react-router-dom 7. `base: '/admin/'`, `BrowserRouter basename="/admin"`. Endereço final: `https://fitos.rbsconsulting.com.br/admin`, mesmo domínio da API (não precisa de CORS).

## Rodar
- Backend em `localhost:3000` (`npm run dev` em `backend/`), depois `npm run dev` em `web/` e abrir `http://localhost:5173/admin/`. O proxy do Vite manda `/portal` e `/auth` ao backend (mesma origem, como em produção).
- `npm run build` gera `dist/` (já roda `tsc --noEmit`).

## Autenticação (decidido)
- **Access token só em memória** (variável em `src/api.ts`); nada em localStorage/sessionStorage. Recarregar a página pede um novo access token pelo cookie.
- **Refresh token em cookie httpOnly** (`fitos_portal_rt`; `HttpOnly; SameSite=Strict; Path=/portal; Secure` em produção), emitido por rotas próprias do backend, `POST /portal/login|refresh|logout`. O app mobile continua usando `/auth/*` com o refresh no corpo, sem mudança. Essas rotas exigem o cabeçalho `X-Fitos-Portal: 1` (defesa extra contra CSRF).
- O refresh token é de uso único (rotação). Chamadas simultâneas ao refresh compartilham uma só requisição (`refreshSession`), senão o React StrictMode usaria o mesmo cookie duas vezes e derrubaria a sessão.
- **Quem entra** (regra nova, decidida depois da etapa 1): qualquer conta ativa; a permissão é por rota no backend, que consulta o banco a cada requisição (`requirePortalAccess`, `requirePlatformAdmin`, `requireProfessional`). A regra antiga (só admin/profissional, aluno com 403) não vale mais no backend.
- Atenção: o backend passou a aceitar qualquer conta ativa no portal (marcador `is_platform_admin`, ver `backend/src/modules/portal/STATUS.md`); o front ainda tem a checagem antiga `PORTAL_ROLES` em `src/auth.tsx` e barra aluno. Ajustar no passo 2.
- Telas: `/login`, `/usuarios` (placeholder). Guarda de rota em `App.tsx` (`RequireAuth`).

## Deploy
- `Dockerfile` (build com Node + nginx:alpine, fallback SPA em `/admin/*`, porta interna 80, sem porta publicada) e `nginx.conf`. A proposta de labels do Traefik está em DEPLOY_VPS.md ("Portal /admin (proposta)"). O `docker-compose.yml` ainda não foi alterado (só existe na VPS).

## Pendências
- Etapa 2: Usuários e papéis, Assinaturas e cotas, Catálogos, Métricas de uso — cada uma com rota de backend atrás de `requireAuth` + `requirePortalAccess` + `requirePlatformAdmin` ou `requireProfessional` e teste.
- Limite de tentativas no login do portal (hoje a API não limita nenhum login).
- Testar a interface num navegador e o container na VPS.
