ALTER TABLE folios_acceso
  MODIFY estatus ENUM('ACTIVO', 'CONFIGURANDO', 'USADO', 'SUSPENDIDO', 'VENCIDO')
  NOT NULL DEFAULT 'ACTIVO';

CREATE TABLE IF NOT EXISTS cuentas_empresa (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id BIGINT UNSIGNED NOT NULL,
  usuario VARCHAR(80) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cuentas_empresa_empresa (empresa_id),
  UNIQUE KEY uq_cuentas_empresa_usuario (usuario),
  CONSTRAINT fk_cuentas_empresa_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sesiones_empresa (
  token CHAR(64) NOT NULL,
  empresa_id BIGINT UNSIGNED NOT NULL,
  proposito ENUM('CONFIGURAR_CUENTA', 'REGISTRAR_PERSONA') NOT NULL,
  expira_en DATETIME NOT NULL,
  usado_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_sesiones_empresa_empresa (empresa_id),
  KEY idx_sesiones_empresa_expira (expira_en),
  CONSTRAINT fk_sesiones_empresa_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS personas_curso (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id BIGINT UNSIGNED NOT NULL,
  nombres VARCHAR(120) NOT NULL,
  apellido_paterno VARCHAR(100) NOT NULL,
  apellido_materno VARCHAR(100) NULL,
  puesto VARCHAR(150) NOT NULL,
  telefono VARCHAR(30) NOT NULL,
  correo VARCHAR(180) NOT NULL,
  estatus ENUM('REGISTRADO', 'EN_CURSO', 'APROBADO', 'REPROBADO') NOT NULL DEFAULT 'REGISTRADO',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_personas_curso_empresa (empresa_id),
  KEY idx_personas_curso_correo (correo),
  CONSTRAINT fk_personas_curso_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
