# SESSÃO ATUAL

Objetivo desta sessão: cotas por plano, painel do professor, visual estilo iOS, consolidação da documentação e questionário de preferências alimentares.

Feito (no código, commitado até 436d65d; `tsc` e testes do backend OK, nada testado em aparelho):
- Cotas por plano no backend: migration 018 (`usage_quotas`), `quotas.service.ts` com janela deslizante, `GET /quotas`, 429 `quota_exceeded`, consumo só depois do sucesso da IA; limite provisório em memória do onboarding removido. Teste: `npm run test:quotas`.
- Cotas no app: contador de fotos restantes e aviso de liberação em `lib/quotas.ts` e `food/photo.tsx`, com `ApiError.details` em `lib/api.ts`.
- Painel do professor: `/trainer/students[/:id]`, `suggest-plan`, telas e prescrição (`npm run test:trainer`).
- Visual estilo iOS (tema azul, `ui.tsx`, navegação, títulos grandes nas abas, listas agrupadas com divisores) e safe area nas telas de pilha, incluindo "Foto → calorias".
- Preferências alimentares: catálogo de 150 itens (`preferences/food-catalog.ts`), migration 019, `GET/PUT /preferences/foods`, prompt da IA com gosta/não gosta, busca e candidatos da foto ordenados pelas preferências, nova etapa 6 no onboarding (agora 8 etapas) e Perfil > Minhas preferências. Testes: `test:preferences`, `test:onboarding`, `test:quotas`, `test:recognize`, `check:food-catalog` (backend OK; app com `tsc` OK, sem teste no aparelho; sem commit ainda).
- Perfil > Alimentação: Minhas preferências, Alimentos favoritos (campo compartilhado com o onboarding) e Refeições favoritas com tela de edição (`PUT /nutrition/templates/:id`, coberto em `test:preferences`). `tsc` OK nos dois; app sem teste no aparelho; sem commit.
- Deploy documentado só em Docker + Traefik (PM2 desativado) e seção "Reconstruir o servidor do zero" no DEPLOY_VPS.md.

Próxima sessão — objetivo: fechar o ciclo de teste e subir para a VPS, depois começar o módulo de Corrida.
1. VPS: `git pull`, migrations pendentes (até a 019), `docker compose up -d --build` (DEPLOY_VPS.md).
2. Gerar o APK release (`gradlew.bat assembleRelease`) e testar no aparelho (lista em PROXIMOS_PASSOS.md, "Fazer agora").
3. Tratar o 429 `quota_exceeded` no onboarding do app; versionar o `docker-compose.yml` da VPS (peça o conteúdo ao dono do projeto).
4. Comparar `claude-haiku-5-5` com `claude-opus-4-5` em fotos reais antes de trocar o modelo; limpar os exercícios de teste "Supino 562029" e "Agachamento 562029" do banco local.
