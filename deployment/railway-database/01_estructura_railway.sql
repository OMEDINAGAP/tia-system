SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

DROP TABLE IF EXISTS `admin_sessions`;
CREATE TABLE `admin_sessions` (
  `token` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `admin_id` bigint unsigned NOT NULL,
  `expires_at` datetime NOT NULL,
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_admin_sessions_admin` (`admin_id`),
  CONSTRAINT `fk_admin_sessions_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP TABLE IF EXISTS `admins`;
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
DROP TABLE IF EXISTS `cuentas_empresa`;
CREATE TABLE `cuentas_empresa` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `empresa_id` bigint unsigned NOT NULL,
  `usuario` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` char(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_salt` char(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cuentas_empresa_empresa` (`empresa_id`),
  UNIQUE KEY `uq_cuentas_empresa_usuario` (`usuario`),
  CONSTRAINT `fk_cuentas_empresa_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP TABLE IF EXISTS `empresas`;
CREATE TABLE `empresas` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `folio_acceso_id` bigint unsigned NOT NULL,
  `nombre` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `razon_social` varchar(220) COLLATE utf8mb4_unicode_ci NOT NULL,
  `representante_legal` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefono_1` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefono_2` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `correo_1` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `correo_2` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `direccion` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_empresas_folio_acceso` (`folio_acceso_id`),
  KEY `idx_empresas_nombre` (`nombre`),
  KEY `idx_empresas_razon_social` (`razon_social`),
  CONSTRAINT `fk_empresas_folio_acceso` FOREIGN KEY (`folio_acceso_id`) REFERENCES `folios_acceso` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP TABLE IF EXISTS `exam_sessions`;
CREATE TABLE `exam_sessions` (
  `token` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `question_ids` json NOT NULL,
  `score` decimal(5,2) DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `logged_at` datetime DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`token`),
  KEY `idx_exam_sessions_user` (`user_id`),
  CONSTRAINT `fk_exam_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP TABLE IF EXISTS `folios_acceso`;
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
DROP TABLE IF EXISTS `notificaciones_correo`;
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
DROP TABLE IF EXISTS `personas_curso`;
CREATE TABLE `personas_curso` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `empresa_id` bigint unsigned NOT NULL,
  `folio` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_id` bigint unsigned DEFAULT NULL,
  `nombres` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `apellido_paterno` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `apellido_materno` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `puesto` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefono` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `correo` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `estatus` enum('REGISTRADO','EN_CURSO','APROBADO','REPROBADO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'REGISTRADO',
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_personas_curso_folio` (`folio`),
  UNIQUE KEY `uq_personas_curso_user` (`user_id`),
  KEY `idx_personas_curso_empresa` (`empresa_id`),
  KEY `idx_personas_curso_correo` (`correo`),
  CONSTRAINT `fk_personas_curso_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_personas_curso_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP TABLE IF EXISTS `questions`;
CREATE TABLE `questions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `question` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_a` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_b` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_c` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_d` text COLLATE utf8mb4_unicode_ci,
  `correct` enum('A','B','C','D') COLLATE utf8mb4_unicode_ci NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `source_document` tinyint unsigned DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_questions_text` (`question`(190))
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP TABLE IF EXISTS `sesiones_empresa`;
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
DROP TABLE IF EXISTS `sesiones_registro_empresa`;
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
DROP TABLE IF EXISTS `sessions`;
CREATE TABLE `sessions` (
  `token` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` bigint unsigned NOT NULL,
  `expires` bigint NOT NULL,
  PRIMARY KEY (`token`),
  KEY `idx_sessions_user` (`userId`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(220) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `puesto` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telefono` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `correo` varchar(180) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `folio` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `loginTime` datetime DEFAULT NULL,
  `photo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `photo_data` longblob,
  `photo_mime` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_registrada_en` datetime DEFAULT NULL,
  `foto_estatus` enum('PENDIENTE','APROBADA','RECHAZADA') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_revisada_en` datetime DEFAULT NULL,
  `foto_revisada_por` bigint unsigned DEFAULT NULL,
  `foto_motivo_rechazo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exam` decimal(5,2) NOT NULL DEFAULT '0.00',
  `intentos` int NOT NULL DEFAULT '0',
  `aprobado` tinyint(1) NOT NULL DEFAULT '0',
  `fecha` datetime DEFAULT NULL,
  `qr` longtext COLLATE utf8mb4_unicode_ci,
  `video` decimal(5,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_folio` (`folio`),
  KEY `fk_users_foto_revisor` (`foto_revisada_por`),
  CONSTRAINT `fk_users_foto_revisor` FOREIGN KEY (`foto_revisada_por`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP TABLE IF EXISTS `video_progress`;
CREATE TABLE `video_progress` (
  `userId` bigint unsigned NOT NULL,
  `videoIndex` int NOT NULL,
  `progress` decimal(6,2) NOT NULL DEFAULT '0.00',
  `completed` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`userId`,`videoIndex`),
  CONSTRAINT `fk_video_progress_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
