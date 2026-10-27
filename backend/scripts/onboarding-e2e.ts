/**
 * Teste ponta a ponta do onboarding: cadastra um usuário, preenche o questionário etapa por etapa usando a MESMA
 * lógica do app (mobile/src/lib/onboarding.ts), chama POST /onboarding/complete e mostra o plano de treino e o
 * plano alimentar gerados.
 *
 *   npm run test:onboarding
 *
 * - Com ANTHROPIC_API_KEY no backend/.env (ou no ambiente), usa a Claude API de verdade.
 * - Sem chave, sobe um servidor Anthropic SIMULADO (as respostas NÃO vêm de IA): valida o fluxo, o parse e os
 *   erros, mas o conteúdo dos planos é montado por regras do próprio script.
 * O usuário de teste é apagado no fim.
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import { Pool } from 'pg';
import { fullPayload, parseFavorites, stepPayload, validateStep, emptyForm, type OnboardingForm } from '../../mobile/src/lib/onboarding';

const PORT = 3998;
const MOCK_PORT = 4011;
const API = `http://localhost:${PORT}`;
const useReal = !!process.env.ANTHROPIC_API_KEY;
let mockMode: 'good' | 'bad' | 'truncated' = 'good';

// ---------- perfil de exemplo ----------
const born = new Date();
born.setFullYear(born.getFullYear() - 30);
born.setMonth(born.getMonth() - 1); // 30 anos e 1 mês: evita aniversário no dia do teste
const dd = (n: number) => String(n).padStart(2, '0');

const form: OnboardingForm = {
  ...emptyForm(),
  name: 'Teste Onboarding',
  birthDate: `${dd(born.getDate())}/${dd(born.getMonth() + 1)}/${born.getFullYear()}`,
  sex: 'male',
  heightCm: '175',
  weightKg: '80',
  goal: 'gain_muscle',
  level: 'intermediate',
  daysPerWeek: 4,
  sessionMinutes: 60,
  location: 'gym',
  modalities: ['strength'],
  dietRestrictions: ['none'],
  mealsPerDay: 5,
  water: '1to2',
  favoriteFoods: 'arroz, feijão, frango grelhado, ovo cozido, batata doce',
};

// ---------- Anthropic simulado ----------
function mockPlan(prompt: string) {
  const refOf = (section: string, name: RegExp) => {
    const body = prompt.split(section)[1]?.split(/\n\n/)[0] ?? '';
    const line = body.split('\n').find((l) => name.test(l));
    return Number(line?.split(' | ')[0]);
  };
  const ex = (re: RegExp) => refOf('CATÁLOGO DE EXERCÍCIOS', re);
  const food = (re: RegExp) => refOf('CATÁLOGO DE ALIMENTOS', re);
  const set = (re: RegExp, sets: number, reps: string) => ({ ref: ex(re), sets, reps, restSeconds: 90 });
  return {
    title: 'Hipertrofia ABCD (simulado)',
    durationWeeks: 8,
    summary: 'Plano simulado pelo script de teste. Superávit calórico moderado com divisão ABCD.',
    days: [
      { dayOfWeek: 1, muscleGroup: 'Peito e tríceps', sets: [set(/^\d+ \| Supino reto \|/, 4, '8-10'), set(/Supino inclinado/, 3, '10'), set(/Crucifixo/, 3, '12'), set(/Tríceps pulley/, 3, '12')] },
      { dayOfWeek: 2, muscleGroup: 'Costas e bíceps', sets: [set(/Puxada frontal/, 4, '8-10'), set(/Remada curvada/, 3, '10'), set(/Rosca direta/, 3, '10')] },
      { dayOfWeek: 4, muscleGroup: 'Pernas', sets: [set(/Agachamento livre/, 4, '8-10'), set(/Leg press/, 3, '12'), set(/Cadeira flexora/, 3, '12'), set(/Panturrilha em pé/, 4, '15')] },
      { dayOfWeek: 5, muscleGroup: 'Ombros e abdômen', sets: [set(/Desenvolvimento com halteres/, 4, '10'), set(/Elevação lateral/, 3, '12'), set(/Prancha/, 3, '30')] },
    ],
    meals: [
      { name: 'Café da manhã', timeSuggestion: '07:30', items: [{ foodRef: food(/Ovo, de galinha/), quantityG: 100 }, { foodRef: food(/Banana, prata/), quantityG: 100 }, { foodRef: food(/Aveia/), quantityG: 40 }] },
      { name: 'Lanche da manhã', timeSuggestion: '10:00', items: [{ foodRef: food(/Iogurte, natural/), quantityG: 170 }, { foodRef: food(/Amendoim/), quantityG: 30 }] },
      { name: 'Almoço', timeSuggestion: '12:30', items: [{ foodRef: food(/Arroz, tipo 1, cozido/), quantityG: 200 }, { foodRef: food(/Feijão, carioca, cozido/), quantityG: 120 }, { foodRef: food(/Frango, peito, sem pele, grelhado/), quantityG: 150 }] },
      { name: 'Lanche da tarde', timeSuggestion: '16:00', items: [{ foodRef: food(/Batata, doce, cozida/), quantityG: 200 }, { foodRef: food(/Ovo, de galinha/), quantityG: 100 }] },
      { name: 'Jantar', timeSuggestion: '20:00', items: [{ foodRef: food(/Arroz, tipo 1, cozido/), quantityG: 150 }, { foodRef: food(/Feijão, carioca, cozido/), quantityG: 100 }, { foodRef: food(/Frango, peito, sem pele, grelhado/), quantityG: 150 }, { foodRef: food(/Brócolis/), quantityG: 80 }] },
    ],
  };
}

const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => {
    const prompt = JSON.parse(data).messages[0].content as string;
    let input: unknown = mockPlan(prompt);
    if (mockMode === 'bad') input = { title: 'Sem dias', summary: '', days: 'nada', meals: [] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ stop_reason: mockMode === 'truncated' ? 'max_tokens' : 'tool_use', content: [{ type: 'tool_use', name: 'criar_plano', input }] }));
  });
});

// ---------- util ----------
const call = async (path: string, opts: { method?: string; body?: unknown } = {}, token?: string) => {
  const r = await fetch(API + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
let failures = 0;
const check = (ok: boolean, what: string, extra?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${what}${!ok && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
};
const killPort = (port: number) => {
  if (process.platform === 'win32') {
    try {
      execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`, { stdio: 'ignore' });
    } catch {
      /* nada a encerrar */
    }
  }
};

async function main() {
  console.log(`MODO: ${useReal ? 'Claude API REAL' : 'Anthropic SIMULADO (sem ANTHROPIC_API_KEY) — o conteúdo dos planos NÃO vem de IA'}\n`);
  if (!useReal) await new Promise<void>((r) => mock.listen(MOCK_PORT, r));

  const server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development',
      ...(useReal ? {} : { ANTHROPIC_API_KEY: 'chave-de-teste', ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}` }),
    },
    shell: true,
  });
  server.stdout.on('data', (d) => process.stdout.write(`   │ ${String(d).replace(/\n(?=.)/g, '\n   │ ')}`));
  server.stderr.on('data', (d) => process.stderr.write(`   │ ${String(d).replace(/\n(?=.)/g, '\n   │ ')}`));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) break;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const email = `onb-e2e-${Date.now()}@teste.local`;
  try {
    // 1) cadastro
    const reg = await call('/auth/register', { method: 'POST', body: { name: 'Teste Onboarding', email, password: 'SenhaTeste123!', role: 'student' } });
    check(reg.status === 201, 'cadastro do usuário de teste', reg.body);
    const token = reg.body.accessToken as string;
    const me = await call('/profile', {}, token);
    check(me.body.onboardingNeeded === true, 'perfil novo => onboardingNeeded = true');

    // 2) etapas 1..6, exatamente como o app: valida, monta o payload e envia no PUT /profile
    console.log('\n— Etapas do questionário (PUT /profile) —');
    for (let step = 1; step <= 6; step++) {
      const problem = validateStep(step, form);
      check(problem === null, `etapa ${step}: validação do app`, problem);
      const body = stepPayload(step, form);
      const put = await call('/profile', { method: 'PUT', body }, token);
      check(put.status === 200, `etapa ${step}: PUT /profile`, put.body);
      const sent = Object.keys((body.onboarding as { answers: object }).answers);
      const lost = sent.filter((k) => !(k in (put.body?.onboarding?.answers ?? {})));
      check(lost.length === 0, `etapa ${step}: respostas gravadas (${sent.join(', ') || 'só perfil'})`, lost);
      check(put.body?.onboarding?.step === Math.min(step + 1, 7), `etapa ${step}: retoma na etapa ${Math.min(step + 1, 7)}`, put.body?.onboarding?.step);
    }
    const saved = await call('/profile', {}, token);
    check(saved.body.weightKg === 80 && saved.body.heightCm === 175 && saved.body.sex === 'male', 'perfil: peso 80, altura 175, masculino');
    check(saved.body.fitnessLevel === 'intermediate' && saved.body.goal === 'Ganhar massa muscular', 'perfil: nível e objetivo');
    check(JSON.stringify(saved.body.onboarding.answers.favoriteFoods) === JSON.stringify(parseFavorites(form.favoriteFoods)), 'favoritos gravados', saved.body.onboarding.answers.favoriteFoods);

    // 3) erros da IA: formato inválido e resposta truncada => 422 com detalhes
    if (!useReal) {
      console.log('\n— Resposta inválida da IA (simulada) —');
      mockMode = 'bad';
      const bad = await call('/onboarding/complete', { method: 'POST', body: fullPayload(form) }, token);
      check(bad.status === 422 && bad.body?.error === 'ai_invalid_response' && Array.isArray(bad.body?.details?.issues), 'formato inválido => 422 ai_invalid_response com details.issues', bad);
      if (bad.status === 422) console.log('   campos reportados:', bad.body.details.issues.map((i: { path: string }) => i.path).join(', '));
      mockMode = 'truncated';
      const cut = await call('/onboarding/complete', { method: 'POST', body: fullPayload(form) }, token);
      check(cut.status === 422, 'resposta truncada (max_tokens) => 422', cut);
      mockMode = 'good';
      const still = await call('/profile', {}, token);
      check(still.body.onboardingNeeded === true, 'após falha o onboarding continua pendente (nada foi gravado)');
      const plans = await call('/workout/plans?status=active', {}, token);
      check(plans.body.length === 0, 'após falha nenhum plano foi criado', plans.body);
      const q0 = await call('/quotas', {}, token);
      check(q0.body?.ai_workout_plan?.used === 0, 'falha da IA (422) não consome a cota de plano de treino', q0.body);
    }

    // 4) conclusão: o app manda tudo no corpo do POST
    console.log('\n— POST /onboarding/complete —');
    const started = Date.now();
    const done = await call('/onboarding/complete', { method: 'POST', body: fullPayload(form) }, token);
    check(done.status === 201, `POST /onboarding/complete (${((Date.now() - started) / 1000).toFixed(1)} s)`, done.body);
    if (done.status !== 201) return;
    const r = done.body;
    const q1 = await call('/quotas', {}, token);
    check(q1.body?.ai_workout_plan?.used === 1 && q1.body.ai_workout_plan.remaining === 0, 'sucesso consome a cota de plano de treino (1 de 1)', q1.body);
    const again = await call('/onboarding/complete', { method: 'POST', body: fullPayload(form) }, token);
    check(again.status === 429 && again.body?.error === 'quota_exceeded' && typeof again.body?.resetsAt === 'string', 'segunda geração => 429 quota_exceeded com resetsAt', again.body);

    console.log('\n═════════ NUTRIÇÃO ═════════');
    const n = r.nutrition;
    console.log(`IMC ${n.bmi} (${n.bmiCategory}) · TMB ${n.bmr} kcal · fator ${n.activityFactor} · gasto ${n.tdee} kcal · ajuste ${n.adjustmentPct}%`);
    console.log(`META: ${n.kcal} kcal · proteína ${n.proteinG} g · carboidrato ${n.carbG} g · gordura ${n.fatG} g`);
    if (r.defaultsUsed.length) console.log('valores padrão usados:', r.defaultsUsed.join(', '));

    console.log('\n═════════ PLANO ALIMENTAR ═════════');
    for (const m of r.mealPlan.meals) {
      const kcal = m.items.reduce((s: number, i: { kcal: number }) => s + i.kcal, 0);
      console.log(`${m.timeSuggestion ?? '--:--'}  ${m.name} (${Math.round(kcal)} kcal)`);
      for (const i of m.items) console.log(`         ${String(i.quantityG).padStart(5)} g  ${i.name} — ${i.kcal} kcal, P ${i.proteinG} g, C ${i.carbG} g, G ${i.fatG} g`);
    }
    const t = r.mealPlan.totals;
    console.log(`TOTAL DO DIA: ${t.kcal} kcal · P ${t.proteinG} g · C ${t.carbG} g · G ${t.fatG} g   (meta ${n.kcal} kcal)`);

    const plan = await call(`/workout/plans/${r.planId}`, {}, token);
    console.log(`\n═════════ PLANO DE TREINO: ${plan.body.title} (${plan.body.durationWeeks ?? '?'} semanas) ═════════`);
    const WD = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    for (const d of plan.body.days) {
      console.log(`${WD[d.dayOfWeek]} — ${d.muscleGroup}${d.notes ? ` (${d.notes})` : ''}`);
      for (const s of d.sets) console.log(`         ${s.exercise.name}: ${s.sets}× ${s.reps ?? `${s.durationMin} min${s.distanceKm ? ` / ${s.distanceKm} km` : ''}`}${s.restSeconds ? ` · desc ${s.restSeconds}s` : ''}`);
    }
    console.log(`\nResumo da IA: ${r.summary}\n`);

    // 5) verificações finais
    console.log('— Verificações —');
    check(plan.body.source === 'ai' && plan.body.status === 'active', 'plano de treino gravado (source ai, ativo)');
    check(plan.body.days.length === 4, 'quatro dias de treino', plan.body.days.length);
    check(Math.abs(t.kcal - n.kcal) <= n.kcal * 0.05, 'plano alimentar dentro de 5% da meta de kcal', { total: t.kcal, meta: n.kcal });
    const names = r.mealPlan.meals.flatMap((m: { items: { name: string }[] }) => m.items.map((i) => i.name)).join(' | ');
    for (const fav of ['Arroz cozido', 'Feijão carioca cozido', 'Frango grelhado', 'Ovo cozido', 'Batata doce cozida']) check(names.includes(fav), `favorito presente no plano alimentar: ${fav}`);
    const after = await call('/profile', {}, token);
    check(after.body.onboardingNeeded === false && !!after.body.onboarding.completedAt, 'onboarding marcado como concluído');
    const day = await call(`/nutrition/logs?date=${new Date().toISOString().slice(0, 10)}`, {}, token);
    check(day.body.targets?.kcalSource === 'dynamic' && day.body.targets?.kcal === day.body.energy?.targetKcal && day.body.targets?.proteinG === n.proteinG, 'aba Nutrição: kcal vem do cálculo do dia (base + treino); macros, do plano da IA', day.body.targets);
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => undefined);
    await pool.end();
    server.kill();
    killPort(PORT);
    mock.close();
  }
  console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} VERIFICAÇÃO(ÕES) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().then(() => process.exit(), (err) => {
  console.error(err);
  killPort(PORT);
  process.exit(1);
});
