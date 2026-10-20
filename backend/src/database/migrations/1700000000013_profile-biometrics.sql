-- Up Migration
-- Dados biométricos adicionais do perfil (todos opcionais).
ALTER TABLE profiles ADD COLUMN sex TEXT CHECK (sex IN ('male', 'female', 'other'));
ALTER TABLE profiles ADD COLUMN body_fat_pct NUMERIC(4,1) CHECK (body_fat_pct > 0 AND body_fat_pct < 100);
ALTER TABLE profiles ADD COLUMN resting_hr_bpm INT CHECK (resting_hr_bpm BETWEEN 20 AND 200);
ALTER TABLE profiles ADD COLUMN max_hr_bpm INT CHECK (max_hr_bpm BETWEEN 80 AND 260);

-- Down Migration
ALTER TABLE profiles DROP COLUMN max_hr_bpm;
ALTER TABLE profiles DROP COLUMN resting_hr_bpm;
ALTER TABLE profiles DROP COLUMN body_fat_pct;
ALTER TABLE profiles DROP COLUMN sex;
