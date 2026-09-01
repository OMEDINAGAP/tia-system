ALTER TABLE users
  ADD COLUMN foto_estatus ENUM('PENDIENTE','APROBADA','RECHAZADA') NULL AFTER foto_registrada_en,
  ADD COLUMN foto_revisada_en DATETIME NULL AFTER foto_estatus,
  ADD COLUMN foto_revisada_por BIGINT UNSIGNED NULL AFTER foto_revisada_en,
  ADD COLUMN foto_motivo_rechazo VARCHAR(500) NULL AFTER foto_revisada_por,
  ADD CONSTRAINT fk_users_foto_revisor FOREIGN KEY (foto_revisada_por) REFERENCES admins(id) ON DELETE SET NULL;

UPDATE users SET foto_estatus='PENDIENTE' WHERE photo IS NOT NULL AND foto_estatus IS NULL;

CREATE TABLE IF NOT EXISTS notificaciones_correo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo VARCHAR(60) NOT NULL,
  destinatario VARCHAR(180) NOT NULL,
  asunto VARCHAR(250) NOT NULL,
  persona_id BIGINT UNSIGNED NULL,
  estatus ENUM('ENVIADO','ERROR') NOT NULL,
  detalle VARCHAR(1000) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id),
  KEY idx_notificaciones_persona(persona_id),
  CONSTRAINT fk_notificaciones_persona FOREIGN KEY(persona_id) REFERENCES personas_curso(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
