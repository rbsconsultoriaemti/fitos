import 'dotenv/config';

const env = process.env.NODE_ENV ?? 'development';
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET ?? '';

if (env === 'production' && (jwtAccessSecret.length < 32 || jwtAccessSecret === 'troque-isto')) {
  throw new Error('JWT_ACCESS_SECRET deve ter ao menos 32 caracteres em produção');
}

export const config = {
  env,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  invite: {
    // Deep link / URL aberta pelo aluno; o token é anexado ao final.
    baseUrl: process.env.INVITE_BASE_URL ?? 'fitos://invite/',
    ttlDays: Number(process.env.INVITE_TTL_DAYS ?? 7),
  },
  jwt: {
    accessSecret: jwtAccessSecret,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
  },
};
