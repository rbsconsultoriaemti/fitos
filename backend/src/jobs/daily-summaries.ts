import { pool } from '../database/pool';
import { config } from '../shared/config';

/**
 * Job noturno: recalcula daily_summaries a partir de food_logs.
 * Uso: npm run job:daily-summaries [YYYY-MM-DD]  (padrão: ontem, no fuso de config.timezone)
 */
async function main() {
  const arg = process.argv[2];
  const { rows } = await pool.query<{ d: string }>(
    `SELECT COALESCE($1::date, (now() AT TIME ZONE $2)::date - 1)::text AS d`,
    [arg ?? null, config.timezone],
  );
  const date = rows[0].d;

  const { rowCount } = await pool.query(
    `INSERT INTO daily_summaries (user_id, log_date, total_kcal, total_protein_g, total_carb_g, total_fat_g)
     SELECT l.user_id, $1::date,
            round(sum(f.kcal_per_100g * l.quantity_g / 100), 1),
            round(sum(f.protein_per_100g * l.quantity_g / 100), 1),
            round(sum(f.carb_per_100g * l.quantity_g / 100), 1),
            round(sum(f.fat_per_100g * l.quantity_g / 100), 1)
     FROM food_logs l JOIN foods f ON f.id = l.food_id
     WHERE l.logged_at >= ($1::date)::timestamp AT TIME ZONE $2
       AND l.logged_at <  (($1::date) + 1)::timestamp AT TIME ZONE $2
     GROUP BY l.user_id
     ON CONFLICT (user_id, log_date) DO UPDATE SET
       total_kcal = EXCLUDED.total_kcal, total_protein_g = EXCLUDED.total_protein_g,
       total_carb_g = EXCLUDED.total_carb_g, total_fat_g = EXCLUDED.total_fat_g`,
    [date, config.timezone],
  );
  console.log(`daily_summaries ${date}: ${rowCount} usuário(s) atualizados`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
