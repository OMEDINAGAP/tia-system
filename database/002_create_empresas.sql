-- Datos de la empresa asociados a un folio de acceso.

CREATE TABLE IF NOT EXISTS empresas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  folio_acceso_id BIGINT UNSIGNED NOT NULL,
  nombre VARCHAR(180) NOT NULL,
  razon_social VARCHAR(220) NOT NULL,
  representante_legal VARCHAR(180) NOT NULL,
  telefono_1 VARCHAR(30) NOT NULL,
  telefono_2 VARCHAR(30) NOT NULL,
  correo_1 VARCHAR(180) NOT NULL,
  correo_2 VARCHAR(180) NOT NULL,
  direccion TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_empresas_folio_acceso (folio_acceso_id),
  KEY idx_empresas_nombre (nombre),
  KEY idx_empresas_razon_social (razon_social),
  CONSTRAINT fk_empresas_folio_acceso
    FOREIGN KEY (folio_acceso_id) REFERENCES folios_acceso (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- Sesiones breves usadas solamente durante el registro de la empresa.
CREATE TABLE IF NOT EXISTS sesiones_registro_empresa (
  token CHAR(64) NOT NULL,
  folio_acceso_id BIGINT UNSIGNED NOT NULL,
  expira_en DATETIME NOT NULL,
  usado_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (token),
  KEY idx_sesiones_registro_folio (folio_acceso_id),
  KEY idx_sesiones_registro_expira (expira_en),
  CONSTRAINT fk_sesiones_registro_folio
    FOREIGN KEY (folio_acceso_id) REFERENCES folios_acceso (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
