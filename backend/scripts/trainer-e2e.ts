/**
 * Painel do professor: vincula alunos pelo fluxo real de convite, prescreve planos, registra treinos e confere
 * GET /trainer/students (status do dia, resumo, sequência) e GET /trainer/students/:id (plano, últimos treinos,
 * aderência semanal), além das regras de acesso e da lógica pura de sequência/aderência.
 *
 *   npm run test:trainer
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import { Pool } from 'pg';
import { addDays, isoWeekdayOf, mondayOf, STREAK_MIN, streak, todayIn, weeklyAdherence, type PlanInfo } from '../src/modules/trainer/trainer.logic';

const PORT = 3993;
const MOCK_PORT = 4013;
const API = `http://localhost:${PORT}`;
const TZ = process.env.APP_TIMEZONE ?? 'America/Sao_Paulo';

// Claude simulado: guarda o pedido recebido e devolve um treino de 2 dias usando os refs 1 e 2 do catálogo.
let claudeBody: { system: string; messages: { content: string }[]; tools: { name: string; input_schema: { properties: Record<string, unknown>; required: string[] } }[] } | null = null;
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => {
    claudeBody = JSON.parse(data);
    const input = {
      title: 'Treino IA',
      durationWeeks: 8,
      summary: 'Rascunho simulado.',
      days: [
        { dayOfWeek: 1, muscleGroup: 'Superiores', sets: [{ ref: 1, sets: 3, reps: '10' }, { ref: 2, sets: 3, reps: '12' }] },
        { dayOfWeek: 4, muscleGroup: 'Inferiores', sets: [{ ref: 1, sets: 4, reps: '8-10' }] },
      ],
    };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'criar_treino', input }] }));
  });
});

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

async function call(path: string, token: string | null, method = 'GET', body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

function logicTests() {
  const all: PlanInfo = { startDate: '2026-01-01', weekdays: new Set([1, 2, 3, 4, 5, 6, 7]) };
  const monWedFri: PlanInfo = { startDate: '2026-01-01', weekdays: new Set([1, 3, 5]) };
  // 2026-10-23 é sexta-feira
  check(isoWeekdayOf('2026-10-23') === 5 && isoWeekdayOf('2026-10-25') === 7 && isoWeekdayOf('2026-10-26') === 1, 'dia da semana ISO (sex=5, dom=7, seg=1)');
  check(mondayOf('2026-10-23') === '2026-10-19' && mondayOf('2026-10-25') === '2026-10-19', 'segunda-feira da semana');
  check(streak(monWedFri, new Set(['2026-10-23', '2026-10-21', '2026-10-19']), '2026-10-23') === 3, 'sequência: dias de descanso (qui, ter) não quebram');
  check(streak(monWedFri, new Set(['2026-10-21', '2026-10-19']), '2026-10-23') === 2, 'sequência: hoje (sex) ainda sem treino não quebra');
  check(streak(monWedFri, new Set(['2026-10-23', '2026-10-19']), '2026-10-23') === 1, 'sequência: quarta prescrita sem registro quebra');
  check(streak(all, new Set(['2026-10-23']), '2026-10-23') === 1 && streak(null, new Set(['2026-10-23']), '2026-10-23') === 0, 'sequência: sem plano = 0');
  check(streak({ ...all, startDate: '2026-10-22' }, new Set(['2026-10-23', '2026-10-22', '2026-10-21']), '2026-10-23') === 2, 'sequência: não conta dias antes da criação do plano');
  const w = weeklyAdherence(monWedFri, new Set(['2026-10-19', '2026-10-21']), '2026-10-23', 2);
  check(w.length === 2 && w[1].weekStart === '2026-10-19' && w[1].prescribed === 2 && w[1].done === 2 && w[1].pct === 100, 'aderência: semana atual = seg e qua feitos de 2 prescritos (sex de hoje ainda não conta)', w[1]);
  check(w[0].weekStart === '2026-10-12' && w[0].prescribed === 3 && w[0].done === 0 && w[0].pct === 0, 'aderência: semana anterior sem registro = 0%', w[0]);
  check(weeklyAdherence(null, new Set(), '2026-10-23', 1)[0].pct === null, 'aderência: sem plano = pct nulo');
  check(addDays('2026-12-31', 1) === '2027-01-01', 'addDays vira o ano');
}

async function main() {
  console.log('— Lógica pura —');
  logicTests();

  await new Promise<void>((r) => mock.listen(MOCK_PORT, r));
  const server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: 'chave-de-teste', ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}` }, shell: true });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) break;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const stamp = Date.now();
  const emails: string[] = [];
  const register = async (name: string, role: string) => {
    const email = `trn-${name.toLowerCase()}-${stamp}@teste.local`;
    emails.push(email);
    const r = await call('/auth/register', null, 'POST', { name: `Aluno ${name}`, email, password: 'SenhaTeste123!', role });
    return { token: r.body.accessToken as string, id: r.body.user.id as string };
  };
  try {
    console.log('\n— API —');
    const trainer = await register('Prof', 'trainer');
    const other = await register('OutroProf', 'trainer');
    const [a, b, c, d, e] = [await register('Ana', 'student'), await register('Bruno', 'student'), await register('Carla', 'student'), await register('Davi', 'student'), await register('Eva', 'student')];

    // vínculo pelo fluxo real de convite
    for (const s of [a, b, c, d]) {
      const inv = await call('/invites/generate', trainer.token, 'POST');
      const acc = await call('/invites/accept', s.token, 'POST', { token: inv.body.token });
      if (acc.status !== 200) check(false, 'aceitar convite', acc.body);
    }
    const invOther = await call('/invites/generate', other.token, 'POST');
    await call('/invites/accept', e.token, 'POST', { token: invOther.body.token });

    const today = todayIn(TZ);
    const todayDow = isoWeekdayOf(today);
    const exercises = (await call('/workout/exercises', trainer.token)).body as { id: string }[];
    const sets = [{ exerciseId: exercises[0].id, sets: 4, reps: '10', loadKg: 20, restSeconds: 60 }, { exerciseId: exercises[1].id, sets: 3, reps: '12', restSeconds: 60 }];
    const prescribe = async (studentId: string, token: string, days: number[]) => {
      const r = await call('/workout/plans', token, 'POST', { studentId, title: 'Plano teste', days: days.map((dow) => ({ dayOfWeek: dow, muscleGroup: 'Peito', sets })) });
      const ap = await call(`/workout/plans/${r.body.id}/approve`, token, 'POST');
      return ap.body as { id: string; days: { id: string; dayOfWeek: number; sets: { id: string }[] }[] };
    };
    const everyDay = [1, 2, 3, 4, 5, 6, 7];
    const planA = await prescribe(a.id, trainer.token, everyDay);
    await prescribe(b.id, trainer.token, everyDay);
    await prescribe(c.id, trainer.token, [(todayDow % 7) + 1]); // só amanhã: hoje é descanso
    // D sem plano

    // A treina hoje (pelo app) e tem mais 2 treinos anteriores (inseridos direto, com o plano criado há 30 dias)
    const dayToday = planA.days.find((x) => x.dayOfWeek === todayDow)!;
    const log = await call('/workout/logs', a.token, 'POST', {
      planId: planA.id,
      dayId: dayToday.id,
      perceivedEffort: 8,
      sets: dayToday.sets.map((s, i) => ({ setId: s.id, setsDone: i === 0 ? 4 : 2 })),
    });
    check(log.status === 201, 'aluna A registra o treino de hoje', log.body);
    await pool.query("UPDATE workout_plans SET created_at = now() - interval '30 days' WHERE id = $1", [planA.id]);
    for (const back of [1, 2]) {
      const day = planA.days.find((x) => x.dayOfWeek === isoWeekdayOf(addDays(today, -back)))!;
      await pool.query(`INSERT INTO workout_logs (student_id, plan_id, day_id, performed_at, perceived_effort) VALUES ($1, $2, $3, now() - ($4 || ' days')::interval, 6)`, [a.id, planA.id, day.id, String(back)]);
    }
    await call('/profile', a.token, 'PUT', { heightCm: 170, weightKg: 72.25, fitnessLevel: 'intermediate' });

    // lista
    const list = await call('/trainer/students', trainer.token);
    const by = (n: string) => list.body.students.find((s: { name: string }) => s.name === `Aluno ${n}`);
    check(list.status === 200 && list.body.summary.total === 4, 'lista: 4 alunos vinculados (a aluna de outro professor não aparece)', list.body.summary);
    check(by('Ana')?.todayStatus === 'trained' && by('Bruno')?.todayStatus === 'pending' && by('Carla')?.todayStatus === 'rest' && by('Davi')?.todayStatus === 'no_plan', 'status do dia: Ana treinou, Bruno pendente, Carla descanso, Davi sem plano', list.body.students.map((s: { name: string; todayStatus: string }) => [s.name, s.todayStatus]));
    check(list.body.summary.trainedToday === 1, 'resumo: 1 treinou hoje', list.body.summary);
    check(by('Ana')?.streak === 3 && by('Ana')?.onStreak === true && by('Bruno')?.streak === 0, 'sequência: Ana 3 treinos seguidos (em sequência), Bruno 0', [by('Ana')?.streak, by('Bruno')?.streak]);
    check(list.body.summary.onStreak === 1 && list.body.summary.streakMin === STREAK_MIN, 'resumo: 1 aluno em sequência', list.body.summary);
    check(list.body.students[0].name === 'Aluno Ana' && list.body.students.length === 4, 'ordem alfabética');

    // detalhe
    const det = await call(`/trainer/students/${a.id}`, trainer.token);
    check(det.status === 200 && det.body.student.name === 'Aluno Ana' && det.body.student.bmi === 25 && det.body.student.bmiCategory === 'sobrepeso', 'detalhe: nome e IMC (72,25 kg / 1,70 m = 25,0)', det.body.student);
    check(det.body.student.fitnessLevel === 'intermediate', 'detalhe: nível');
    check(det.body.plan?.id === planA.id && det.body.plan.days.length === 7 && det.body.plan.days[0].sets[0].exercise.name, 'detalhe: plano ativo com 7 dias e exercícios');
    check(det.body.recentLogs.length === 3 && det.body.recentLogs[0].setsDone === 6 && det.body.recentLogs[0].setsPrescribed === 7 && det.body.recentLogs[0].adherencePct === 86 && det.body.recentLogs[0].perceivedEffort === 8, 'detalhe: último treino 6/7 séries = 86%, esforço 8', det.body.recentLogs[0]);
    check(det.body.recentLogs[1].setsDone === 0 && det.body.recentLogs[1].adherencePct === 0, 'detalhe: treino sem séries registradas = 0%');
    const weekNow = det.body.weeklyAdherence.at(-1);
    const sinceMonday = isoWeekdayOf(today);
    const doneNow = Math.min(3, sinceMonday);
    check(det.body.weeklyAdherence.length === 8 && weekNow.weekStart === mondayOf(today) && weekNow.prescribed === sinceMonday && weekNow.done === doneNow && weekNow.pct === Math.round((doneNow / sinceMonday) * 100), 'detalhe: aderência semanal (8 semanas; semana atual confere)', weekNow);
    check(det.body.weeklyAdherence[0].pct === 0 || det.body.weeklyAdherence[0].pct === null, 'detalhe: semanas antigas sem treino = 0%');

    // acesso
    check((await call(`/trainer/students/${e.id}`, trainer.token)).status === 404, 'aluno de outro professor => 404');
    check((await call(`/trainer/students/${a.id}`, other.token)).status === 404, 'professor sem vínculo => 404');
    check((await call('/trainer/students', a.token)).status === 403, 'aluno não acessa o painel => 403');
    check((await call('/trainer/students', null)).status === 401, 'sem login => 401');
    check((await call('/trainer/students/abc', trainer.token)).status === 400, 'id inválido => 400');
    const none = await call('/trainer/students', other.token);
    check(none.body.summary.total === 1 && none.body.students[0].todayStatus === 'no_plan', 'outro professor vê só a aluna dele (sem plano)');
    // sugestão da IA: só as barreiras (a chamada real à Claude não roda no teste)
    const sug = (id: string, token: string) => call(`/trainer/students/${id}/suggest-plan`, token, 'POST');
    check((await sug(e.id, trainer.token)).status === 404, 'sugerir: aluno de outro professor => 404');
    check((await sug(a.id, other.token)).status === 404, 'sugerir: professor sem vínculo => 404');
    check((await sug(a.id, a.token)).status === 403, 'sugerir: aluno não pode => 403');
    const incomplete = await sug(d.id, trainer.token);
    check(incomplete.status === 400 && incomplete.body.error === 'student_profile_incomplete', 'sugerir: perfil do aluno incompleto => 400 com mensagem', incomplete.body);
    // sugestão com Claude simulado: prompt só de treino
    const h = await register('Hugo', 'student');
    const invH = await call('/invites/generate', trainer.token, 'POST');
    await call('/invites/accept', h.token, 'POST', { token: invH.body.token });
    await call('/profile', h.token, 'PUT', { birthDate: '1995-03-15', sex: 'male', heightCm: 180, weightKg: 80, fitnessLevel: 'intermediate' });
    const ok = await sug(h.id, trainer.token);
    check(ok.status === 200 && ok.body.title === 'Treino IA' && ok.body.days.length === 2 && ok.body.days[0].sets[0].exerciseName && ok.body.summary, 'sugerir: devolve o rascunho com nomes dos exercícios', ok.body);
    check(!('meals' in ok.body) && !('mealPlan' in ok.body), 'sugerir: resposta sem plano alimentar');
    const props = Object.keys(claudeBody?.tools[0].input_schema.properties ?? {});
    check(claudeBody?.tools[0].name === 'criar_treino' && !props.includes('meals') && !claudeBody.tools[0].input_schema.required.includes('meals'), 'sugerir: ferramenta da Claude sem o campo de alimentação', props);
    const sent = `${claudeBody?.system}
${claudeBody?.messages[0].content}`;
    check(!/aliment|kcal|refei|CATÁLOGO DE ALIMENTOS|META NUTRICIONAL/i.test(sent), 'sugerir: prompt sem nenhuma parte de alimentação');
    check(/CATÁLOGO DE EXERCÍCIOS/.test(sent) && /Objetivo:/.test(sent) && /Nível:/.test(sent) && /idade: 30|idade: 31/.test(sent), 'sugerir: prompt traz perfil, objetivo, nível e catálogo de exercícios');
    console.log(`  (prompt de treino: ${sent.length} caracteres)`);
    const again = await sug(h.id, trainer.token);
    check(again.status === 429, 'sugerir: segunda chamada seguida => 429', again.status);
    const saved = await call(`/workout/plans?studentId=${h.id}`, trainer.token);
    check(saved.status === 200 && saved.body.length === 0, 'sugerir não grava nenhum plano', saved.body);

    // prioridade do plano do professor
    const f = await register('Fabio', 'student');
    const invF = await call('/invites/generate', trainer.token, 'POST');
    await call('/invites/accept', f.token, 'POST', { token: invF.body.token });
    const own = await call('/workout/plans', f.token, 'POST', { title: 'Meu plano', days: [{ dayOfWeek: 2, muscleGroup: 'Costas', sets }] });
    check(own.status === 201 && own.body.source === 'self' && own.body.status === 'active', 'aluno cria plano próprio ativo', own.body);
    await pool.query("INSERT INTO workout_plans (owner_id, title, source, status) VALUES ($1, 'Plano IA', 'ai', 'active')", [f.id]);
    const activeOf = async (token: string) => ((await call('/workout/plans?status=active', token)).body as { title: string; source: string }[]);
    check((await activeOf(f.token)).length === 2, 'antes: aluno tem 2 planos ativos (self + ai)');
    const p1 = await prescribe(f.id, trainer.token, [1, 3]);
    let act = await activeOf(f.token);
    check(act.length === 1 && act[0].source === 'trainer', 'aprovar plano do professor arquiva self e ai: aluno vê só o do professor', act);
    const p2 = await call('/workout/plans', trainer.token, 'POST', { studentId: f.id, title: 'Plano novo', days: [{ dayOfWeek: 4, muscleGroup: 'Pernas', sets }] });
    await call(`/workout/plans/${p2.body.id}/approve`, trainer.token, 'POST');
    act = await activeOf(f.token);
    check(act.length === 1 && act[0].title === 'Plano novo', 'novo plano do professor substitui o anterior (só o mais recente)', act);
    const ar2 = await call(`/workout/plans/${p2.body.id}/archive`, trainer.token, 'POST');
    check(ar2.status === 200, 'professor arquiva o plano novo', ar2.body);
    check((await activeOf(f.token)).length === 0, 'arquivar o mais recente não ressuscita o plano antigo do professor nem os próprios (foram substituídos por outro plano)');
    // cenário limpo: um único plano do professor sobre os planos próprios
    const g = await register('Gabi', 'student');
    const invG = await call('/invites/generate', trainer.token, 'POST');
    await call('/invites/accept', g.token, 'POST', { token: invG.body.token });
    await call('/workout/plans', g.token, 'POST', { title: 'Plano da Gabi', days: [{ dayOfWeek: 2, muscleGroup: 'Costas', sets }] });
    await pool.query("INSERT INTO workout_plans (owner_id, title, source, status) VALUES ($1, 'Plano IA', 'ai', 'active')", [g.id]);
    const pg = await prescribe(g.id, trainer.token, [1]);
    check((await activeOf(g.token)).length === 1, 'Gabi: só o plano do professor');
    await call(`/workout/plans/${pg.id}/archive`, trainer.token, 'POST');
    act = await activeOf(g.token);
    check(act.length === 2 && act.every((x) => x.source !== 'trainer'), 'professor arquiva o plano dele: aluno volta aos planos próprios (self + ai)', act);
    void p1;
    const empty = await register('Vazio', 'trainer');
    check((await call('/trainer/students', empty.token)).body.summary.total === 0, 'professor sem alunos: lista vazia');
  } finally {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [emails]).catch(() => undefined);
    await pool.end();
    server.kill();
    mock.close();
    killPort(PORT);
  }
  console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} VERIFICAÇÃO(ÕES) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().then(() => process.exit(), (err) => {
  console.error(err);
  killPort(PORT);
  process.exit(1);
});
