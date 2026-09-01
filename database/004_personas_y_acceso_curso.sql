-- Tablas base que utiliza el modulo existente de curso, examen y sesiones.
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(220) NOT NULL,
  company VARCHAR(180) NOT NULL,
  puesto VARCHAR(150) NULL,
  telefono VARCHAR(30) NULL,
  correo VARCHAR(180) NULL,
  folio VARCHAR(50) NOT NULL,
  loginTime DATETIME NULL,
  photo VARCHAR(500) NULL,
  exam DECIMAL(5,2) NOT NULL DEFAULT 0,
  intentos INT NOT NULL DEFAULT 0,
  aprobado TINYINT(1) NOT NULL DEFAULT 0,
  fecha DATETIME NULL,
  qr LONGTEXT NULL,
  video DECIMAL(5,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_folio (folio)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token CHAR(64) NOT NULL,
  userId BIGINT UNSIGNED NOT NULL,
  expires BIGINT NOT NULL,
  PRIMARY KEY (token),
  KEY idx_sessions_user (userId),
  CONSTRAINT fk_sessions_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS video_progress (
  userId BIGINT UNSIGNED NOT NULL,
  videoIndex INT NOT NULL,
  progress DECIMAL(6,2) NOT NULL DEFAULT 0,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (userId, videoIndex),
  CONSTRAINT fk_video_progress_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE personas_curso
  ADD COLUMN folio VARCHAR(50) NULL AFTER empresa_id,
  ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER folio,
  ADD UNIQUE KEY uq_personas_curso_folio (folio),
  ADD UNIQUE KEY uq_personas_curso_user (user_id),
  ADD CONSTRAINT fk_personas_curso_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE sesiones_empresa
  MODIFY proposito ENUM('CONFIGURAR_CUENTA', 'REGISTRAR_PERSONA', 'GESTIONAR_PERSONAS') NOT NULL;
