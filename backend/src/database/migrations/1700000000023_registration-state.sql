-- Up Migration
-- UF (estado) onde o conselho emitiu o registro do profissional. Obrigatória no aceite do convite (regra na API);
-- a coluna aceita NULL para contas antigas (alunos e profissionais cadastrados antes desta migration).
ALTER TABLE users ADD COLUMN registration_state CHAR(2);
ALTER TABLE users ADD CONSTRAINT users_registration_state_check CHECK (
  registration_state IS NULL OR registration_state IN (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI',
    'RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  )
);

-- Down Migration
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_registration_state_check;
ALTER TABLE users DROP COLUMN IF EXISTS registration_state;
