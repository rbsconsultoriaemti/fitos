import { pool } from '../pool';

/**
 * Preenche exercises.image_urls com as imagens do free-exercise-db (The Unlicense, domínio público):
 * https://github.com/yuhonas/free-exercise-db
 *
 * Nome do exercício no nosso banco -> id do exercício no dataset. O script confere cada id contra o
 * dataset (mesma versão fixada abaixo) e só grava as URLs que existem. Uso: npm run seed:images
 */

// Versão fixada do dataset: as URLs não mudam se o repositório for reorganizado.
const REF = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
const DATA_URL = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${REF}/dist/exercises.json`;
const IMAGE_BASE = `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@${REF}/exercises`;

const MAP: Record<string, string> = {
  // peito
  'Supino reto': 'Barbell_Bench_Press_-_Medium_Grip',
  'Supino inclinado': 'Barbell_Incline_Bench_Press_-_Medium_Grip',
  'Supino reto com halteres': 'Dumbbell_Bench_Press',
  Crucifixo: 'Dumbbell_Flyes',
  'Peck deck': 'Butterfly',
  Crossover: 'Cable_Crossover',
  // costas
  'Puxada frontal': 'Wide-Grip_Lat_Pulldown',
  'Remada curvada': 'Bent_Over_Barbell_Row',
  'Remada unilateral': 'One-Arm_Dumbbell_Row',
  'Pull-up': 'Pullups',
  'Remada na máquina': 'Leverage_Iso_Row',
  // ombros
  'Desenvolvimento com halteres': 'Dumbbell_Shoulder_Press',
  'Elevação lateral': 'Side_Lateral_Raise',
  'Elevação frontal': 'Front_Dumbbell_Raise',
  'Remada alta': 'Upright_Barbell_Row',
  // bíceps
  'Rosca direta': 'Barbell_Curl',
  'Rosca alternada': 'Dumbbell_Alternate_Bicep_Curl',
  'Rosca scott': 'Preacher_Curl',
  'Rosca martelo': 'Hammer_Curls',
  // tríceps
  'Tríceps pulley': 'Triceps_Pushdown',
  'Tríceps testa': 'EZ-Bar_Skullcrusher',
  Mergulho: 'Dips_-_Triceps_Version',
  'Extensão unilateral de tríceps': 'Dumbbell_One-Arm_Triceps_Extension',
  // pernas
  'Agachamento livre': 'Barbell_Squat',
  'Leg press': 'Leg_Press',
  'Cadeira extensora': 'Leg_Extensions',
  'Cadeira flexora': 'Seated_Leg_Curl',
  Stiff: 'Stiff-Legged_Barbell_Deadlift',
  Avanço: 'Dumbbell_Lunges',
  'Panturrilha em pé': 'Standing_Calf_Raises',
  'Panturrilha sentado': 'Seated_Calf_Raise',
  // core
  Prancha: 'Plank',
  'Abdominal supra': 'Crunches',
  'Abdominal infra': 'Reverse_Crunch',
  'Abdominal oblíquo': 'Oblique_Crunches',
  // funcional
  'Agachamento com salto': 'Freehand_Jump_Squat',
  'Mountain climber': 'Mountain_Climbers',
  'Kettlebell swing': 'One-Arm_Kettlebell_Swings',
  'Turkish get-up': 'Kettlebell_Turkish_Get-Up_Squat_style',
  // cardio
  'Corrida de rua': 'Trail_Running_Walking',
  'Corrida na esteira': 'Running_Treadmill',
  'Corrida leve (regenerativo)': 'Jogging_Treadmill',
  'Caminhada inclinada na esteira': 'Walking_Treadmill',
  'Bike ergométrica': 'Bicycling_Stationary',
  Spinning: 'Bicycling_Stationary',
  'Bike na rua (ciclismo)': 'Bicycling',
  'Remo ergométrico': 'Rowing_Stationary',
  Elíptico: 'Elliptical_Trainer',
};

async function main() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Não consegui baixar o dataset (${res.status})`);
  const dataset = (await res.json()) as { id: string; images: string[] }[];
  const byId = new Map(dataset.map((e) => [e.id, e]));

  let updated = 0;
  for (const [name, id] of Object.entries(MAP)) {
    const entry = byId.get(id);
    if (!entry || entry.images.length === 0) {
      console.warn(`! id "${id}" não existe no dataset (${name})`);
      continue;
    }
    const urls = entry.images.map((file) => `${IMAGE_BASE}/${file.split('/').map(encodeURIComponent).join('/')}`);
    const { rowCount } = await pool.query('UPDATE exercises SET image_urls = $2 WHERE name = $1', [name, urls]);
    if (rowCount) updated++;
    else console.warn(`! exercício "${name}" não existe no nosso banco`);
  }

  const { rows } = await pool.query<{ name: string }>("SELECT name FROM exercises WHERE image_urls = '{}' ORDER BY name");
  console.log(`${updated} exercícios com imagem.`);
  if (rows.length) console.log(`Sem imagem (${rows.length}): ${rows.map((r) => r.name).join(', ')}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
