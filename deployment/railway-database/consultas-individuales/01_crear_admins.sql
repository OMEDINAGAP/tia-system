CREATE TABLE `admins` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `usuario` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pin` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` char(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_salt` char(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rol` enum('SUPERADMIN','GESTOR') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'GESTOR',
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admins_pin` (`pin`),
  UNIQUE KEY `uq_admins_usuario` (`usuario`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
