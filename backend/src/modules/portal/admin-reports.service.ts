import { pool } from '../../database/pool';
import { getQuotaStatus, type QuotaStatus } from '../quotas/quotas.service';
import { PAGE_SIZE } from './admin-users.schemas';
import { PROFESSIONAL_ROLES } from './portal.access';

const DAY_MS = 86_400_000;

/**
 * Custo estimado por chamada de IA, em reais. É ESTIMATIVA para o painel, não fatura: ajuste pela tarifa do modelo em
 * uso (env AI_COST_PER_CALL_BRL). Padrão conservador: o mesmo valor para foto e para plano.
 */
const COST_PER_CALL_BRL = Number(process.env.AI_COST_PER_CALL_BRL ?? '0.20');

const clampDays = (days: number) => Math.min(365, Math.max(1, Math.floor(days)));

/**
 * Métricas de uso (somente leitura). Contagens do banco; nada de dados pessoais. "Ativo no período" = teve sessão
 * (login ou renovação de token) dentro da janela; é uma aproximação, pois o sistema não guarda cada login.
 */
export async function getMetrics(days: number) {
  const windowDays = clampDays(days);
  const windowMs = windowDays * DAY_MS;

  const { rows: [u] } = await pool.query<Record<string, string>>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE is_active) AS active,
            count(*) FILTER (WHERE role = 'student') AS students,
            count(*) FILTER (WHERE role::text = ANY($1::text[])) AS professionals,
            count(*) FILTER (WHERE validation_status = 'pending') AS pending_professionals,
            count(*) FILTER (WHERE created_at > now() - ($2::bigint * interval '1 millisecond')) AS new_in_window
       FROM users`,
    [PROFESSIONAL_ROLES, windowMs],
  );

  const { rows: [a] } = await pool.query<Record<string, string>>(
    `SELECT count(DISTINCT user_id) FILTER (WHERE created_at > now() - ($1::bigint * interval '1 millisecond')) AS window_users,
            count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '7 days') AS last_7_days_users
       FROM refresh_tokens`,
    [windowMs],
  );

  const { rows: usage } = await pool.query<{ kind: string; n: string }>(
    `SELECT kind, count(*) AS n FROM usage_quotas
      WHERE used_at > now() - ($1::bigint * interval '1 millisecond')
      GROUP BY kind`,
    [windowMs],
  );
  const byKind = Object.fromEntries(usage.map((r) => [r.kind, Number(r.n)]));
  const photos = byKind.photo_recognition ?? 0;
  const plans = byKind.ai_workout_plan ?? 0;

  // Assinatura atual de cada conta: a linha mais recente (premium antes de free).
  const { rows: [s] } = await pool.query<Record<string, string>>(
    `WITH latest AS (
       SELECT DISTINCT ON (user_id) user_id, plan, status, expires_at
         FROM subscriptions
        ORDER BY user_id, (plan = 'premium') DESC, updated_at DESC
     )
     SELECT count(*) FILTER (WHERE plan = 'premium' AND status = 'active' AND (expires_at IS NULL OR expires_at > now())) AS premium_active,
            count(*) FILTER (WHERE status = 'trialing') AS trialing,
            count(*) FILTER (WHERE status = 'past_due') AS past_due
       FROM latest`,
  );

  const costPerCall = COST_PER_CALL_BRL;
  const estimatedCostBrl = Math.round((photos + plans) * costPerCall * 100) / 100;

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    users: {
      total: Number(u.total),
      active: Number(u.active),
      students: Number(u.students),
      professionals: Number(u.professionals),
      pendingProfessionals: Number(u.pending_professionals),
      newInWindow: Number(u.new_in_window),
    },
    activity: {
      activeInWindow: Number(a.window_users),
      activeLast7Days: Number(a.last_7_days_users),
    },
    usage: {
      photoRecognitions: photos,
      workoutPlansByAi: plans,
    },
    subscriptions: {
      premiumActive: Number(s.premium_active),
      trialing: Number(s.trialing),
      pastDue: Number(s.past_due),
    },
    aiCost: {
      costPerCallBrl: costPerCall,
      estimatedBrl: estimatedCostBrl,
      note: 'Estimativa: contagem de chamadas bem-sucedidas × custo por chamada configurado (AI_COST_PER_CALL_BRL).',
    },
  };
}

interface SubRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  plan: string | null;
  status: string | null;
  expires_at: Date | null;
  auto_renew: boolean | null;
  store: string | null;
  environment: string | null;
  product_id: string | null;
}

const quotaView = (s: QuotaStatus) => ({ used: s.used, limit: s.limit, remaining: s.remaining, resetsAt: s.resetsAt, plan: s.plan });

/**
 * Assinaturas e cotas de cada conta (somente leitura: a assinatura muda só pelo RevenueCat). O plano efetivo vem da
 * mesma regra usada pelas cotas (premium ativo e dentro da validade), não só do registro.
 */
export async function listSubscriptions(q: string | undefined, page: number) {
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = pattern ? "WHERE u.name ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\'" : '';
  const params = pattern ? [pattern] : [];
  const total = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM users u ${where}`, params)).rows[0].n);
  const { rows } = await pool.query<SubRow>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active,
            s.plan, s.status, s.expires_at, s.auto_renew, s.store, s.environment, s.product_id
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM subscriptions x WHERE x.user_id = u.id ORDER BY (x.plan = 'premium') DESC, x.updated_at DESC LIMIT 1
       ) s ON true
       ${where}
       ORDER BY u.created_at DESC, u.id
       LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );

  const items = await Promise.all(
    rows.map(async (r) => {
      const photo = await getQuotaStatus(r.id, 'photo_recognition');
      const plan = await getQuotaStatus(r.id, 'ai_workout_plan');
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        isActive: r.is_active,
        subscription: r.plan
          ? { plan: r.plan, status: r.status, expiresAt: r.expires_at, autoRenew: r.auto_renew, store: r.store, environment: r.environment, productId: r.product_id }
          : null,
        effectivePlan: photo.plan,
        quotas: { photoRecognition: quotaView(photo), workoutPlan: quotaView(plan) },
      };
    }),
  );
  return { items, page, pageSize: PAGE_SIZE, total };
}
