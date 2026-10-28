# STATUS — web (portal de administração e profissionais)

- Estado: **etapa 1 (base) pronta no código**; etapa 2: só a tela Usuários e papéis foi feita (as demais não começaram). `npm run build` e `tsc --noEmit` OK; login, cookie e refresh conferidos com `curl` pelo proxy do Vite. NÃO verificado: a interface num navegador, o Dockerfile (sem Docker nesta máquina) e o roteamento no Traefik.
- Stack: React 19 + Vite 7 + TypeScript + react-router-dom 7. `base: '/admin/'`, `BrowserRouter basename="/admin"`. Endereço final: `https://fitos.rbsconsulting.com.br/admin`, mesmo domínio da API (não precisa de CORS).

## Rodar
- Backend em `localhost:3000` (`npm run dev` em `backend/`), depois `npm run dev` em `web/` e abrir `http://localhost:5173/admin/`. O proxy do Vite manda `/portal` e `/auth` ao backend (mesma origem, como em produção).
- `npm run build` gera `dist/` (já roda `tsc --noEmit`).

## Autenticação (decidido)
- **Access token só em memória** (variável em `src/api.ts`); nada em localStorage/sessionStorage. Recarregar a página pede um novo access token pelo cookie.
- **Refresh token em cookie httpOnly** (`fitos_portal_rt`; `HttpOnly; SameSite=Strict; Path=/portal; Secure` em produção), emitido por rotas próprias do backend, `POST /portal/login|refresh|logout`. O app mobile continua usando `/auth/*` com o refresh no corpo, sem mudança. Essas rotas exigem o cabeçalho `X-Fitos-Portal: 1` (defesa extra contra CSRF).
- O refresh token é de uso único (rotação). Chamadas simultâneas ao refresh compartilham uma só requisição (`refreshSession`), senão o React StrictMode usaria o mesmo cookie duas vezes e derrubaria a sessão.
- **Quem entra** (regra nova, decidida depois da etapa 1): qualquer conta ativa; a permissão é por rota no backend, que consulta o banco a cada requisição (`requirePortalAccess`, `requirePlatformAdmin`, `requireProfessional`). A regra antiga (só admin/profissional, aluno com 403) não vale mais no backend.
- **Sem checagem de papel no front (28/10/2026):** `PORTAL_ROLES` e o bloqueio de aluno em `src/auth.tsx`/`Login.tsx` foram removidos. Qualquer conta ativa entra; o front só lê `GET /portal/me` (`id, name, email, role, isPlatformAdmin`). O 403 vem do backend, rota por rota, e `describeError`/`ErrorNotice` o mostram como aviso de permissão (nenhuma rota de negócio existe ainda para exercitar isso na interface).
- Telas: `/login`, `/` (Início: administrador da plataforma, profissional ou aluno; aluno vê só "A área de administração e de profissionais fica aqui. Seus treinos e sua dieta estão no aplicativo."), `/usuarios` (placeholder, link só na Início do administrador). Guarda de rota em `App.tsx` (`RequireAuth`).

## Deploy
- `Dockerfile` (build com Node + nginx:alpine, fallback SPA em `/admin/*`, porta interna 80, sem porta publicada) e `nginx.conf`. A proposta de labels do Traefik está em DEPLOY_VPS.md ("Portal /admin (proposta)"). O `docker-compose.yml` ainda não foi alterado (só existe na VPS).

## Pendências
- Etapa 2, **Usuários e papéis pronta no código** (`/usuarios` e `/usuarios/:id`, `pages/Users.tsx` e `pages/UserDetail.tsx`; build e `tsc` OK; interface NÃO verificada num navegador): busca por nome/e-mail, tabela (nome, e-mail, papel, ativo, marcador) com paginação de 50, detalhe com troca de papel (só papéis de negócio), ativar/desativar com confirmação, marcador somente leitura e histórico de alterações. Desativar uma conta revoga as sessões dela, inclusive no app (o aluno precisa entrar de novo). "Último acesso" é a data do refresh token mais recente, não um registro de login. Botões desabilitados mostram o motivo vindo do backend (`protections`: própria conta, último administrador). Erros 403/401 usam o `ErrorNotice`. Restam: Assinaturas e cotas, Catálogos, Métricas de uso — cada uma com rota de backend atrás de `requireAuth` + `requirePortalAccess` + `requirePlatformAdmin` ou `requireProfessional` e teste.
- Limite de tentativas no login do portal (hoje a API não limita nenhum login).
- Testar a interface num navegador e o container na VPS.
