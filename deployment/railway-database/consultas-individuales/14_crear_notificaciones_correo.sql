CREATE TABLE `notificaciones_correo` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tipo` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `destinatario` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `asunto` varchar(250) COLLATE utf8mb4_unicode_ci NOT NULL,
  `persona_id` bigint unsigned DEFAULT NULL,
  `estatus` enum('ENVIADO','ERROR') COLLATE utf8mb4_unicode_ci NOT NULL,
  `detalle` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notificaciones_persona` (`persona_id`),
  CONSTRAINT `fk_notificaciones_persona` FOREIGN KEY (`persona_id`) REFERENCES `personas_curso` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
