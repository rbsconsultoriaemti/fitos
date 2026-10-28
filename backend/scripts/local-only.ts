/**
 * Trava dos testes que alteram dados: antes de qualquer acesso ao banco, recusa rodar em produção ou contra um banco
 * que não seja local (host localhost ou 127.0.0.1). Sai com código 2.
 */
export function assertLocalOnly(testName: string): void {
  const refuse = (why: string): never => {
    console.error(`RECUSADO: ${testName} altera dados e só roda no banco local de desenvolvimento. ${why}`);
    process.exit(2);
  };
  if (process.env.NODE_ENV === 'production') refuse('NODE_ENV=production.');
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    refuse('DATABASE_URL ausente ou inválida.');
  }
  if (host !== 'localhost' && host !== '127.0.0.1') refuse(`O host do DATABASE_URL é "${host}" (esperado localhost ou 127.0.0.1).`);
}
