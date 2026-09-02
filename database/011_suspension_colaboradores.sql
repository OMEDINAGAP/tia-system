-- Suspensión de acceso al sistema. No representa la baja formal ante el módulo TIA.
CREATE TABLE IF NOT EXISTS suspensiones_colaborador (
  persona_id BIGINT UNSIGNED NOT NULL,
  empresa_id BIGINT UNSIGNED NOT NULL,
  suspendido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (persona_id),
  KEY idx_suspensiones_empresa (empresa_id),
  CONSTRAINT fk_suspensiones_persona FOREIGN KEY (persona_id) REFERENCES personas_curso(id) ON DELETE CASCADE,
  CONSTRAINT fk_suspensiones_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
