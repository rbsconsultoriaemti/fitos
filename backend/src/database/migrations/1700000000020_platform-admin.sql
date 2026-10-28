-- Up Migration
-- Marcador de administrador da plataforma, separado do papel de negócio (`role`). Só muda por script interno
-- (npm run grant-platform-admin); nenhuma rota da API grava este campo.
ALTER TABLE users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE users DROP COLUMN is_platform_admin;
