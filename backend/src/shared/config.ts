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
  timezone: process.env.APP_TIMEZONE ?? 'America/Sao_Paulo',
  aiService: {
    url: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
    token: process.env.AI_SERVICE_TOKEN ?? '',
  },
  // Claude API chamada direto pelo backend (geração do plano no onboarding). Mesmo .env que o ai-service lê.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-5',
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com', // só muda em testes
  },
  // Saltos de proxy confiáveis (Traefik = 1) para o IP real do cliente; 0 ignora X-Forwarded-For (API exposta direto).
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? (process.env.NODE_ENV === 'production' ? 1 : 0)),
  invite: {
    // Deep link / URL aberta pelo aluno; o token é anexado ao final.
    baseUrl: process.env.INVITE_BASE_URL ?? 'fitos://invite/',
    ttlDays: Number(process.env.INVITE_TTL_DAYS ?? 7),
    // Convites do portal (criam conta com papel): link da página web; o token é anexado ao final.
    portalBaseUrl: process.env.PORTAL_INVITE_BASE_URL ?? 'http://localhost:5173/admin/convite/',
    // Limites em memória: criação por usuário/hora e aceitação por IP/15 min (sobrescrevíveis nos testes).
    createPerHour: Number(process.env.INVITE_CREATE_PER_HOUR ?? 30),
    acceptPer15Min: Number(process.env.INVITE_ACCEPT_PER_15MIN ?? 20),
  },
  // RevenueCat: o valor do cabeçalho Authorization é definido no painel do RevenueCat e precisa ser igual aqui.
  // Sem essa variável todo webhook é recusado. Eventos de sandbox só concedem acesso se REVENUECAT_ACCEPT_SANDBOX=true (testes).
  revenuecat: {
    webhookAuth: process.env.REVENUECAT_WEBHOOK_AUTH ?? '',
    acceptSandbox: process.env.REVENUECAT_ACCEPT_SANDBOX === 'true',
  },
  jwt: {
    accessSecret: jwtAccessSecret,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
  },
};
