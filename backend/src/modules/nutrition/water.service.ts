import { pool } from '../../database/pool';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { AccessTokenPayload } from '../auth/auth.service';
import type { CreateWaterInput } from './nutrition.schemas';

type Auth = AccessTokenPayload;

/** Meta diária (ml) pela resposta do onboarding: "mais de 2 L" -> 2,5 L; qualquer outra (ou sem resposta) -> 2 L. */
export function waterGoalMl(answer: string | null | undefined) {
  return answer === 'gt2' ? 2500 : 2000;
}

const entryOut = (r: { id: string; amount_ml: number; logged_at: Date }) => ({ id: r.id, amountMl: r.amount_ml, loggedAt: r.logged_at });

export async function addWater(auth: Auth, input: CreateWaterInput) {
  const { rows } = await pool.query(
    `INSERT INTO water_logs (user_id, amount_ml, logged_at, client_id)
     VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4)
     ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
     RETURNING id, amount_ml, logged_at`,
    [auth.sub, input.amountMl, input.loggedAt ?? null, input.clientId ?? null],
  );
  if (rows[0]) return { duplicate: false, entry: entryOut(rows[0]) };
  // Reenvio da fila offline: o registro já existe, devolve o mesmo.
  const { rows: existing } = await pool.query('SELECT id, amount_ml, logged_at FROM water_logs WHERE user_id = $1 AND client_id = $2', [auth.sub, input.clientId]);
  return { duplicate: true, entry: entryOut(existing[0]) };
}

/** Total do dia (fuso de config.timezone), meta, registros e total por hora. */
export async function waterToday(auth: Auth, date?: string) {
  const { rows } = await pool.query(
    `SELECT id, amount_ml, logged_at, date_part('hour', logged_at AT TIME ZONE $3)::int AS hour
     FROM water_logs
     WHERE user_id = $1
       AND logged_at >= (COALESCE($2::date, (now() AT TIME ZONE $3)::date))::timestamp AT TIME ZONE $3
       AND logged_at <  (COALESCE($2::date, (now() AT TIME ZONE $3)::date) + 1)::timestamp AT TIME ZONE $3
     ORDER BY logged_at, id`,
    [auth.sub, date ?? null, config.timezone],
  );
  const { rows: prof } = await pool.query(`SELECT onboarding->>'water' AS water FROM profiles WHERE user_id = $1`, [auth.sub]);
  const goalMl = waterGoalMl(prof[0]?.water);
  const totalMl = rows.reduce((sum, r) => sum + r.amount_ml, 0);
  const byHour = new Map<number, number>();
  for (const r of rows) byHour.set(r.hour, (byHour.get(r.hour) ?? 0) + r.amount_ml);
  return {
    date: date ?? null,
    totalMl,
    goalMl,
    percent: Math.round((totalMl / goalMl) * 100),
    entries: rows.map(entryOut),
    byHour: [...byHour].sort((a, b) => a[0] - b[0]).map(([hour, ml]) => ({ hour, totalMl: ml })),
  };
}

export async function deleteWater(auth: Auth, id: string) {
  const { rowCount } = await pool.query('DELETE FROM water_logs WHERE id = $1 AND user_id = $2', [id, auth.sub]);
  if (!rowCount) throw new AppError(404, 'not_found', 'Registro de água não encontrado');
}

