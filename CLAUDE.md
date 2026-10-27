# FitOS — Plataforma de saúde e performance

## O que é esse projeto
App mobile que conecta alunos a profissionais de saúde e performance
(professor de Ed. Física, treinador de corrida, treinador de ciclismo,
nutricionista e psicólogo) numa única plataforma.

Modelo de negócio: profissionais têm acesso GRATUITO e são o canal de
aquisição orgânica (PLG). Receita vem exclusivamente da assinatura dos alunos.

Desenvolvido por: eu (Claude Code) + o dono do projeto.
Não há outros desenvolvedores. Cada sessão começa lendo este arquivo.

---

## Stack decidida — não mudar sem decisão explícita

| Camada         | Tecnologia                                      |
|----------------|-------------------------------------------------|
| Mobile         | React Native + Expo                             |
| Backend API    | Node.js + TypeScript (Express)                  |
| Microserviço IA| Python + FastAPI                                |
| Banco principal| PostgreSQL                                      |
| Cache          | Redis                                           |
| IA — visão     | Claude Vision (foto → calorias)                 |
| IA — texto     | Claude API (treino, dieta, prescrições)         |
| Assinaturas    | RevenueCat                                      |
| Auth           | JWT (access 15min) + refresh token (30 dias)    |
| Storage fotos  | AWS S3                                          |
| Deploy MVP     | VPS própria (Docker + Traefik)                  |
| Deploy escala  | AWS                                             |
| Repositório    | GitHub                                          |

---

## Módulos do sistema

### Módulos ativos (a construir em ordem)
1. **Auth** — cadastro, login, papéis, convites por link _(pronto)_
2. **Musculação** — séries, cargas, periodização, log prescrito vs executado _(pronto)_
3. **Nutrição** — plano alimentar, foto→calorias, log diário, macros _(pronto)_
4. **Corrida de rua** — VDOT, pace por zona, plano por prova, import GPX _(não iniciado)_
5. **Ciclismo** — FTP, TSS, zonas de potência, import FIT/Strava _(não iniciado)_
6. **Psicologia** — sessões, notas criptografadas, check-in de humor, metas _(não iniciado)_

Transversais já feitos: onboarding com plano de treino e plano alimentar gerados pela Claude API, cotas por plano (backend) e painel do professor.

---

## Papéis e permissões

| Papel              | Plano     | Prescreve          | Vê dados do aluno              |
|--------------------|-----------|--------------------|--------------------------------|
| Aluno comum        | Pago      | —                  | Próprios dados                 |
| Prof. Ed. Física   | Gratuito  | Treino musculação  | Treino + aderência             |
| Treinador corrida  | Gratuito  | Plano de corrida   | Pace, FC, GPS, VDOT            |
| Treinador ciclismo | Gratuito  | Plano de ciclismo  | FTP, TSS, potência             |
| Nutricionista      | Gratuito  | Plano alimentar    | Log de comida + macros         |
| Psicólogo          | Gratuito  | Metas bem-estar    | Humor + sono (com consentimento)|
| Admin              | Gratuito  | —                  | Tudo                           |

Roles no banco: `student | trainer | running_coach | cycling_coach | nutritionist | psychologist | admin`

---

## Regras de negócio críticas

- Profissionais convidam alunos via link com token (tabela `invites`)
- `daily_summaries` é tabela derivada — gerada por job noturno, não em tempo real
- `clinical_notes` NUNCA são acessadas pela IA — criptografia AES-256, chave só do psicólogo
- `workout_plans.source` = `'ai' | 'trainer' | 'self'`
- VDOT calibra todos os paces de corrida automaticamente
- FTP em % calibra todos os intervalos de ciclismo automaticamente
- Fluxo de prescrição: IA sugere rascunho → profissional revisa/edita → aprova → aluno recebe

### Limites por plano (decididos em 2026-10-22; cada chamada de IA custa dinheiro)

| Recurso                                    | Plano gratuito (básico)            | Plano pago (R$ 19/mês ou R$ 175/ano) |
|--------------------------------------------|------------------------------------|--------------------------------------|
| Reconhecimento de foto (`POST /nutrition/recognize`) | **10 fotos a cada 30 dias** (janela deslizante) | **20 fotos a cada 24 h** (janela deslizante) |
| Geração de plano de treino por IA (`POST /onboarding/complete`) | **1 geração a cada 3 meses** | **1 geração por semana**             |

- **Janela corrente (decidido), não período de calendário:** o período é contado para trás a partir de agora. Plano de treino por IA: só libera de novo 3 meses (gratuito) ou 7 dias (pago) depois do último uso. Fotos: conta o que foi usado nos últimos 30 dias (gratuito) ou nas últimas 24 h (pago); o limite volta a liberar quando o uso mais antigo da janela completa 30 dias / 24 h. Assim ninguém ganha cota extra por usar no fim de um mês ou de uma semana.
- Estourou o limite → API responde **429** com mensagem amigável (o app mostra quantas fotos restam e quando libera: nos últimos 30 dias para o básico, nas últimas 24 h para o pago).
- O plano pago só vale com assinatura ativa confirmada no RevenueCat; sem confirmação, a cota é a do básico.
- Uso rastreado na tabela `usage_quotas` (migration 018; `backend/src/modules/quotas/`), com janela deslizante. Plano pago = `subscriptions` premium com status `active` e não vencida (a confirmação via RevenueCat ainda é pendência: ver PROXIMOS_PASSOS.md). `GET /quotas` devolve o status das duas cotas.
- Modelo do reconhecimento de foto: migrar de `claude-opus-4-5` para `claude-haiku-5-5` (custo ~R$ 0,20 → ~R$ 0,02 por foto) para sustentar essas cotas.

---

## Tabelas principais do banco (PostgreSQL)

### Módulo usuários
- `users` (id, name, email, password_hash, role, is_active, created_at)
- `profiles` (id, user_id, weight_kg, height_cm, birth_date, goal, fitness_level, restrictions[])
- `subscriptions` (id, user_id, plan, status, expires_at, revenuecat_id)
- `invites` (id, sender_id, role, token, status, expires_at)

### Vínculos profissional → aluno
- `trainer_student` (id, trainer_id, student_id, status, linked_at)
- `running_coach_athlete` (id, running_coach_id, athlete_id, status, linked_at)
- `cycling_coach_athlete` (id, cycling_coach_id, athlete_id, status, linked_at)
- `nutritionist_patient` (id, nutritionist_id, patient_id, status, consent_version, linked_at)
- `psychologist_patient` (id, psychologist_id, patient_id, status, consent_version, consent_signed_at, share_mood_with_trainers)

### Módulo musculação
- `workout_plans` (id, owner_id, prescribed_by, title, source, status, duration_weeks)
- `workout_days` (id, plan_id, day_of_week, muscle_group, notes)
- `exercises` (id, name, category, muscle_group, equipment, video_url)
- `workout_sets` (id, day_id, exercise_id, sets, reps, load_kg, rest_seconds, order)
- `workout_logs` (id, student_id, plan_id, day_id, performed_at, perceived_effort, notes)
- `set_logs` (id, log_id, set_id, sets_done, load_done_kg, reps_done)

### Módulo nutrição
- `diet_plans` (id, patient_id, prescribed_by, title, source, target_kcal, target_protein_g, target_carb_g, target_fat_g, status)
- `meals` (id, plan_id, name, order, time_suggestion)
- `foods` (id, name, source, external_id, category, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, barcode, portions, name_search)
- `meal_foods` (id, meal_id, food_id, quantity_g)
- `food_logs` (id, user_id, food_id, meal_id, meal_type, quantity_g, portion_label, portion_count, photo_url, recognition_source, logged_at)
- `daily_summaries` (id, user_id, log_date, total_kcal, total_protein_g, total_carb_g, total_fat_g, workout_kcal_burned)

### Módulo corrida
- `runner_profiles` (id, user_id, vdot, goal_race, goal_race_date, goal_pace_min_km, weekly_km_base, experience_level)
- `running_plans` (id, runner_id, prescribed_by, title, source, goal_event, duration_weeks, peak_weekly_km, status)
- `running_sessions` (id, plan_id, week_number, day_of_week, session_type, target_distance_km, target_pace_min_km, target_hr_zone)
- `session_intervals` (id, session_id, order, type, distance_km, pace_target, hr_zone)
- `running_logs` (id, runner_id, session_id, started_at, distance_km, duration_sec, avg_pace_min_km, avg_hr_bpm, avg_cadence_spm, gps_track_url, device_source, perceived_effort)
- `race_results` (id, runner_id, race_name, distance, race_date, finish_time_sec, pace_min_km, notes)

### Módulo ciclismo
- `cyclist_profiles` (id, user_id, ftp_watts, weight_kg, wpk, goal_event, bike_type, experience_level, ftp_tested_at)
- `cycling_plans` (id, cyclist_id, prescribed_by, title, source, duration_weeks, peak_weekly_tss, status)
- `cycling_sessions` (id, plan_id, week_number, day_of_week, session_type, target_duration_min, target_power_zone, target_if, target_tss)
- `cycling_intervals` (id, session_id, order, type, duration_sec, power_pct_ftp, power_zone, cadence_rpm, recovery_sec)
- `cycling_logs` (id, cyclist_id, session_id, started_at, distance_km, avg_power_watts, normalized_power_watts, tss_achieved, if_achieved, gps_track_url, device_source, perceived_effort)
- `ftp_tests` (id, cyclist_id, protocol, result_watts, result_wpk, tested_at)

### Módulo psicologia
- `therapy_sessions` (id, psychologist_id, patient_id, scheduled_at, duration_min, modality, status, video_room_url)
- `clinical_notes` (id, session_id, psychologist_id, content_encrypted, encryption_key_ref, created_at)
- `mood_checkins` (id, patient_id, mood_score, anxiety_score, sleep_hours, energy_score, notes, logged_at)
- `wellbeing_goals` (id, patient_id, psychologist_id, title, description, status, target_date)
- `goal_checkins` (id, goal_id, patient_id, status, notes, logged_at)

---

## Compliance obrigatório antes do lançamento

- **Psicologia**: Resolução CFP 11/2018 — app não pode sugerir diagnóstico. IA não acessa notas clínicas.
- **Nutrição**: CFN exige prescrição por nutricionista habilitado. IA é assistente, não substituta.
- **LGPD**: dados de saúde mental são sensíveis — DPO nomeado + RIPD obrigatórios.
- **Crise**: app não gerencia emergências de saúde mental — redireciona para CVV/SAMU.
- **Vídeo psicologia**: salas efêmeras (Daily.co ou Whereby) — sem gravação armazenada.

---

## Estrutura de pastas do projeto

```
fitos/
├── CLAUDE.md                  ← este arquivo (memória permanente)
├── ARQUITETURA.md             ← decisões técnicas detalhadas
├── PROXIMOS_PASSOS.md         ← fila priorizada de tarefas
├── SESSAO_ATUAL.md            ← objetivo da sessão em curso
│
├── backend/                   ← Node.js + TypeScript
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   └── STATUS.md
│   │   │   ├── workout/
│   │   │   │   └── STATUS.md
│   │   │   ├── nutrition/
│   │   │   │   └── STATUS.md
│   │   │   ├── onboarding/    ← plano de treino + alimentar pela Claude API
│   │   │   │   └── STATUS.md
│   │   │   ├── quotas/        ← cotas por plano (usage_quotas, GET /quotas)
│   │   │   │   └── STATUS.md
│   │   │   ├── trainer/       ← painel do professor (/trainer/students...)
│   │   │   │   └── STATUS.md
│   │   │   ├── running/
│   │   │   │   └── STATUS.md
│   │   │   ├── cycling/
│   │   │   │   └── STATUS.md
│   │   │   └── psychology/
│   │   │       └── STATUS.md
│   │   ├── shared/
│   │   └── database/
│   │       └── migrations/
│   └── package.json
│
├── ai-service/                ← Python + FastAPI (foto → calorias), Dockerfile
│   └── STATUS.md
│
├── mobile/                    ← React Native + Expo
│   ├── STATUS.md
│   └── src/lib/quotas.ts      ← contador de cotas no app (usado em food/photo.tsx)
│
└── DEPLOY_VPS.md              ← deploy e reconstrução do servidor (Docker + Traefik)
```

Obs.: `backend/src/modules/profile/` (perfil e questionário) também existe, mas não tem STATUS.md.

---

## Ritual de sessão

### Para INICIAR uma sessão, diga:
"Leia o CLAUDE.md e o STATUS.md do módulo [nome]. Vamos trabalhar em [objetivo]."

### Para ENCERRAR uma sessão, diga:
"Gera o update dos arquivos de memória desta sessão."
Eu produzo o diff exato para você colar nos arquivos STATUS.md e PROXIMOS_PASSOS.md.

### Estado atual do projeto
- Fase: DESENVOLVIMENTO ATIVO
- Último commit: 436d65d (a atualização de documentação desta sessão ainda não foi commitada)
- Módulos prontos: Auth, Musculação, Nutrição (foto→calorias com edição, código de barras, favoritas, meta dinâmica, água com fila offline), onboarding com plano de treino e plano alimentar pela Claude API, notificações locais com tela de configurações
- Cotas por plano: backend pronto e testado (`npm run test:quotas`; migration 018, `GET /quotas`, 429 `quota_exceeded`). App: contador de fotos restantes e aviso de liberação em `mobile/src/lib/quotas.ts` e `food/photo.tsx` (`tsc` OK; NÃO testado no aparelho). Falta o aviso no app quando o plano de treino por IA não está liberado (o onboarding ainda não trata o 429) e a verificação do plano pago via RevenueCat
- Dashboard do professor: concluído no código (backend `/trainer/students[/:id]`, `suggest-plan`, telas e prescrição; `npm run test:trainer`). Falta testar no aparelho e subir na VPS (sem migration nova)
- Visual: tema no estilo iOS aplicado (azul `#007AFF`/`#0A84FF`, títulos grandes nas abas, listas agrupadas com divisores) e correção de safe area nas telas de pilha, incluindo a tela de foto. `tsc` OK; NÃO verificado no aparelho
- App do aluno: onboarding, treino offline, nutrição, água, notificações
- VPS: online em fitos.rbsconsulting.com.br com HTTPS. Produção: backend roda SOMENTE em Docker (container `fitos-fitos-api-1`; ai-service em `fitos-ai-service-1`), roteado pelo Traefik. PM2 desativado. O `docker-compose.yml` da VPS e o Dockerfile da API não estão neste repositório (não verificado; pendente de versionar)
- Deploy na VPS (detalhes em DEPLOY_VPS.md): `cd /var/www/fitos && git pull`, depois (só se houver migration nova)
  `DATABASE_URL="postgres://fitos:$(cat /root/fitos_db_pass.txt)@127.0.0.1:5432/fitos" npm run --prefix backend migrate:up`,
  e por fim `docker compose up -d --build`
- Logs: `docker logs fitos-fitos-api-1 --tail 50` e `docker logs fitos-ai-service-1 --tail 50`
- App mobile em produção: APK release gerado localmente (`C:\fx\mobile\android`: `.\gradlew.bat assembleRelease`)
- O projeto vive em `C:\fx`. Última migration: `018_usage-quotas`; quais já rodaram na VPS: não verificado
- Próximo: testar no aparelho (APK novo), subir na VPS (git pull + migrations pendentes + `docker compose up -d --build`) e depois o módulo de Corrida. Ver PROXIMOS_PASSOS.md
