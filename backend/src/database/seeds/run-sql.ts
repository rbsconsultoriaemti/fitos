import fs from 'fs';
import path from 'path';
import { pool } from '../pool';

/** Executa um arquivo .sql de src/database/seeds (sem depender do psql). Uso: tsx run-sql.ts <arquivo.sql> */
async function main() {
  const name = process.argv[2];
  if (!name || path.basename(name) !== name || !name.endsWith('.sql')) {
    throw new Error('Informe o nome de um arquivo .sql que esteja em src/database/seeds');
  }
  const sql = fs.readFileSync(path.resolve(__dirname, name), 'utf8');
  await pool.query(sql);
  console.log(`${name}: executado`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
