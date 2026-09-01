CREATE TABLE `sesiones_empresa` (
  `token` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `empresa_id` bigint unsigned NOT NULL,
  `proposito` enum('CONFIGURAR_CUENTA','REGISTRAR_PERSONA','GESTIONAR_PERSONAS') COLLATE utf8mb4_unicode_ci NOT NULL,
  `expira_en` datetime NOT NULL,
  `usado_en` datetime DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_sesiones_empresa_empresa` (`empresa_id`),
  KEY `idx_sesiones_empresa_expira` (`expira_en`),
  CONSTRAINT `fk_sesiones_empresa_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
