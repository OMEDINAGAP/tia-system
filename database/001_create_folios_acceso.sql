-- Tabla inicial para controlar los folios autorizados a ingresar al sistema TIA.
-- Compatible con MySQL 8.x y MariaDB 10.5+.

CREATE TABLE IF NOT EXISTS folios_acceso (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  folio VARCHAR(50) NOT NULL,
  fecha_emision DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  empresa VARCHAR(180) NOT NULL,
  estatus ENUM('ACTIVO', 'USADO', 'SUSPENDIDO', 'VENCIDO') NOT NULL DEFAULT 'ACTIVO',
  caducidad DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_folios_acceso_folio (folio),
  KEY idx_folios_acceso_empresa (empresa),
  KEY idx_folios_acceso_estatus_caducidad (estatus, caducidad),
  CONSTRAINT chk_folios_acceso_caducidad
    CHECK (caducidad >= fecha_emision)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- Ejemplo de alta. Sustituir los valores antes de ejecutarlo:
-- INSERT INTO folios_acceso (folio, empresa, caducidad)
-- VALUES ('TIA-EMPRESA-0001', 'Empresa de ejemplo', '2026-12-31 23:59:59');
