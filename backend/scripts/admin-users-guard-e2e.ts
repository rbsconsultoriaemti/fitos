/**
 * Confirma que test:admin-users RECUSA rodar em produção ou contra banco que não seja local, sem tocar em banco algum
 * (os DATABASE_URL usados aqui apontam para hosts falsos e a recusa acontece antes de qualquer conexão).
 *
 *   npm run test:admin-users-guard
 */
import { spawnSync } from 'node:child_process';

let failures = 0;
const check = (ok: boolean, what: string, extra?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${what}${!ok && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
};

function run(env: Record<string, string | undefined>) {
  const r = spawnSync('npx', ['tsx', 'scripts/admin-users-e2e.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const FAKE = 'postgres://u:p@banco-falso.invalid:5432/fitos';

const cases: [string, Record<string, string | undefined>, RegExp][] = [
  ['NODE_ENV=production (mesmo com banco local)', { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@localhost:5432/fitos' }, /NODE_ENV=production/],
  ['host remoto no DATABASE_URL', { NODE_ENV: 'development', DATABASE_URL: FAKE }, /banco-falso\.invalid/],
  ['host remoto parecido com localhost', { NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@localhost.evil.com:5432/fitos' }, /localhost\.evil\.com/],
  ['DATABASE_URL inválida', { NODE_ENV: 'development', DATABASE_URL: 'isto-nao-e-url' }, /ausente ou inválida/],
];

for (const [what, env, message] of cases) {
  const { code, out } = run(env);
  check(code !== 0 && code !== null, `${what}: sai com código diferente de zero`, code);
  check(/RECUSADO/.test(out) && message.test(out), `${what}: mensagem clara`, out.slice(0, 200));
  check(!/— Sem permissão —/.test(out) && !/ECONNREFUSED|ENOTFOUND/.test(out), `${what}: nenhum teste nem conexão foi iniciado`, out.slice(0, 200));
}

console.log(failures === 0 ? '\nTodos os testes passaram.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
