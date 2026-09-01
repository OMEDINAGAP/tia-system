CREATE TABLE `sesiones_registro_empresa` (
  `token` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `folio_acceso_id` bigint unsigned NOT NULL,
  `expira_en` datetime NOT NULL,
  `usado_en` datetime DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_sesiones_registro_folio` (`folio_acceso_id`),
  KEY `idx_sesiones_registro_expira` (`expira_en`),
  CONSTRAINT `fk_sesiones_registro_folio` FOREIGN KEY (`folio_acceso_id`) REFERENCES `folios_acceso` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
