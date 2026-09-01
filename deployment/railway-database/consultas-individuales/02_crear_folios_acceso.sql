CREATE TABLE `folios_acceso` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `folio` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_emision` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `empresa` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `estatus` enum('ACTIVO','CONFIGURANDO','USADO','SUSPENDIDO','VENCIDO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVO',
  `caducidad` datetime NOT NULL,
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_folios_acceso_folio` (`folio`),
  KEY `idx_folios_acceso_empresa` (`empresa`),
  KEY `idx_folios_acceso_estatus_caducidad` (`estatus`,`caducidad`),
  CONSTRAINT `chk_folios_acceso_caducidad` CHECK ((`caducidad` >= `fecha_emision`))
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
