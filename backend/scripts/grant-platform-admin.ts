/**
 * Concede ou revoga o marcador de administrador da plataforma (users.is_platform_admin).
 * É o ÚNICO caminho que altera esse campo: nenhuma rota da API o grava.
 *
 *   npm run grant-platform-admin -- --email pessoa@exemplo.com            # concede
 *   npm run grant-platform-admin -- --email pessoa@exemplo.com --revoke   # revoga
 *
 * Usa DATABASE_URL do ambiente (ou do backend/.env), como o migrate. Registra cada execução em
 * backend/logs/platform-admin.log (ou no arquivo de PLATFORM_ADMIN_LOG).
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

interface Row {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  is_platform_admin: boolean;
}

function fail(message: string): never {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let email: string | undefined;
  let revoke = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--revoke') revoke = true;
    else if (a === '--email') email = argv[++i];
    else if (a.startsWith('--email=')) email = a.slice('--email='.length);
    else fail(`argumento desconhecido: ${a}`);
  }
  if (email === undefined) fail('informe --email <e-mail>. Uso: npm run grant-platform-admin -- --email <e-mail> [--revoke]');
  if (email.length === 0 || /\s/.test(email) || !email.includes('@')) fail(`e-mail inválido: "${email}" (sem espaços e com @)`);
  return { email, revoke };
}

const show = (label: string, u: Row) =>
  console.log(`${label}: id=${u.id} nome="${u.name}" papel=${u.role} is_active=${u.is_active} is_platform_admin=${u.is_platform_admin}`);

async function main() {
  const { email, revoke } = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) fail('DATABASE_URL não definida');
  const action = revoke ? 'revoke' : 'grant';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const found = await pool.query<Row>(
      'SELECT id, name, email, role, is_active, is_platform_admin FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    if (found.rowCount === 0) fail(`nenhum usuário com o e-mail ${email}. Nada foi alterado.`);
    const before = found.rows[0];
    show('Antes ', before);

    if (before.is_platform_admin === !revoke) {
      console.log(`Nada a fazer: a conta já ${revoke ? 'não tem' : 'tem'} o marcador.`);
    }
    const updated = await pool.query<Row>(
      'UPDATE users SET is_platform_admin = $2 WHERE id = $1 RETURNING id, name, email, role, is_active, is_platform_admin',
      [before.id, !revoke],
    );
    const after = updated.rows[0];
    show('Depois', after);

    const logFile = process.env.PLATFORM_ADMIN_LOG ?? path.join(__dirname, '..', 'logs', 'platform-admin.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const unchanged = before.is_platform_admin === after.is_platform_admin ? ' (sem mudança)' : '';
    fs.appendFileSync(logFile, `${new Date().toISOString()} email=${before.email} acao=${action}${unchanged} por=${os.userInfo().username}\n`);
    console.log(`Registrado em ${logFile}`);
    if (!before.is_active) console.log('Aviso: a conta está desativada; o marcador não dá acesso enquanto ela estiver inativa.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
