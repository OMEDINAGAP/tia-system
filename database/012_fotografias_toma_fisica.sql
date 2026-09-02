-- Después de tres fotografías rechazadas, el colaborador debe realizar la toma física en módulo TIA.
CREATE TABLE IF NOT EXISTS fotografias_toma_fisica (
  user_id BIGINT UNSIGNED NOT NULL,
  solicitado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_fotografias_toma_fisica_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
