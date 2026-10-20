-- Seed do catálogo de exercícios (musculação com máquinas/halteres/barra, abdômen e funcionais).
-- Idempotente: o índice único exercises_name_unique (lower(name)) ignora os que já existem.
-- Uso: psql "$DATABASE_URL" -f src/database/seeds/exercises.sql
--
-- category: compound (multiarticular) | isolation (monoarticular) | core | functional | cardio (por tempo/distância)
-- muscle_group: peito | costas | ombros | bíceps | tríceps | pernas | abdômen | corpo inteiro | cardio

INSERT INTO exercises (name, category, muscle_group, equipment) VALUES
  -- Peito
  ('Supino reto',                       'compound',   'peito',   'barra'),
  ('Supino inclinado',                  'compound',   'peito',   'barra'),
  ('Supino reto com halteres',          'compound',   'peito',   'halteres'),
  ('Crucifixo',                         'isolation',  'peito',   'halteres'),
  ('Peck deck',                         'isolation',  'peito',   'máquina'),
  ('Crossover',                         'isolation',  'peito',   'polia'),

  -- Costas
  ('Puxada frontal',                    'compound',   'costas',  'polia'),
  ('Remada curvada',                    'compound',   'costas',  'barra'),
  ('Remada unilateral',                 'compound',   'costas',  'halteres'),
  ('Pull-up',                           'compound',   'costas',  'barra fixa'),
  ('Remada na máquina',                 'compound',   'costas',  'máquina'),

  -- Ombros
  ('Desenvolvimento com halteres',      'compound',   'ombros',  'halteres'),
  ('Elevação lateral',                  'isolation',  'ombros',  'halteres'),
  ('Elevação frontal',                  'isolation',  'ombros',  'halteres'),
  ('Remada alta',                       'compound',   'ombros',  'barra'),

  -- Bíceps
  ('Rosca direta',                      'isolation',  'bíceps',  'barra'),
  ('Rosca alternada',                   'isolation',  'bíceps',  'halteres'),
  ('Rosca scott',                       'isolation',  'bíceps',  'barra W'),
  ('Rosca martelo',                     'isolation',  'bíceps',  'halteres'),

  -- Tríceps
  ('Tríceps pulley',                    'isolation',  'tríceps', 'polia'),
  ('Tríceps testa',                     'isolation',  'tríceps', 'barra W'),
  ('Mergulho',                          'compound',   'tríceps', 'paralelas'),
  ('Extensão unilateral de tríceps',    'isolation',  'tríceps', 'halteres'),

  -- Pernas
  ('Agachamento livre',                 'compound',   'pernas',  'barra'),
  ('Leg press',                         'compound',   'pernas',  'máquina'),
  ('Cadeira extensora',                 'isolation',  'pernas',  'máquina'),
  ('Cadeira flexora',                   'isolation',  'pernas',  'máquina'),
  ('Stiff',                             'compound',   'pernas',  'barra'),
  ('Avanço',                            'compound',   'pernas',  'halteres'),
  ('Panturrilha em pé',                 'isolation',  'pernas',  'máquina'),
  ('Panturrilha sentado',               'isolation',  'pernas',  'máquina'),

  -- Abdômen
  ('Prancha',                           'core',       'abdômen', 'peso corporal'),
  ('Abdominal supra',                   'core',       'abdômen', 'peso corporal'),
  ('Abdominal infra',                   'core',       'abdômen', 'peso corporal'),
  ('Abdominal oblíquo',                 'core',       'abdômen', 'peso corporal'),
  ('Hollow body',                       'core',       'abdômen', 'peso corporal'),

  -- Funcionais
  ('Burpee',                            'functional', 'corpo inteiro', 'peso corporal'),
  ('Agachamento com salto',             'functional', 'pernas',        'peso corporal'),
  ('Mountain climber',                  'functional', 'corpo inteiro', 'peso corporal'),
  ('Kettlebell swing',                  'functional', 'corpo inteiro', 'kettlebell'),
  ('Turkish get-up',                    'functional', 'corpo inteiro', 'kettlebell'),

  -- Cardio (corrida e bike): prescritos por tempo e/ou distância
  ('Corrida de rua',                    'cardio',     'cardio', 'tênis'),
  ('Corrida na esteira',                'cardio',     'cardio', 'esteira'),
  ('Corrida intervalada (tiros)',       'cardio',     'cardio', 'tênis'),
  ('Corrida leve (regenerativo)',       'cardio',     'cardio', 'tênis'),
  ('Caminhada inclinada na esteira',    'cardio',     'cardio', 'esteira'),
  ('Bike na rua (ciclismo)',            'cardio',     'cardio', 'bicicleta'),
  ('Bike ergométrica',                  'cardio',     'cardio', 'bicicleta ergométrica'),
  ('Spinning',                          'cardio',     'cardio', 'bicicleta de spinning'),
  ('Remo ergométrico',                  'cardio',     'cardio', 'remo'),
  ('Elíptico',                          'cardio',     'cardio', 'elíptico')
ON CONFLICT (lower(name)) DO NOTHING;
