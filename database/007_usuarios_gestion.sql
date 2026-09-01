ALTER TABLE admins
  MODIFY COLUMN pin VARCHAR(120) NULL,
  ADD COLUMN usuario VARCHAR(80) NULL AFTER name,
  ADD COLUMN password_hash CHAR(128) NULL AFTER pin,
  ADD COLUMN password_salt CHAR(32) NULL AFTER password_hash,
  ADD COLUMN rol ENUM('SUPERADMIN','GESTOR') NOT NULL DEFAULT 'GESTOR' AFTER password_salt,
  ADD UNIQUE KEY uq_admins_usuario (usuario);

UPDATE admins
SET usuario = COALESCE(usuario, 'admin'), rol = 'SUPERADMIN'
WHERE id = (SELECT id FROM (SELECT MIN(id) AS id FROM admins) inicial);
