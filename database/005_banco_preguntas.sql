CREATE TABLE IF NOT EXISTS questions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NULL,
  correct ENUM('A','B','C','D') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  source_document TINYINT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_questions_text (question(190))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_sessions (
  token CHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  question_ids JSON NOT NULL,
  score DECIMAL(5,2) NULL,
  submitted_at DATETIME NULL,
  logged_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (token),
  KEY idx_exam_sessions_user (user_id),
  CONSTRAINT fk_exam_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO questions
(question,option_a,option_b,option_c,option_d,correct,source_document) VALUES
('¿Qué significa TIA?','Tarjeta para Instalaciones Aeroportuarias','Tarjeta de Información Aérea','Tarjeta de Identificación Aeroportuaria',NULL,'C',1),
('¿Cuál es el objetivo del Plan de Seguridad?','Dar a conocer las instalaciones del aeropuerto','Implementar medidas para prevenir actos de interferencia ilícita','Dar seguridad exclusivamente a los comercios','Todas las anteriores','B',1),
('¿Cuáles autoridades se encuentran en el aeropuerto?','Policía y Tránsito únicamente','AFAC, Aduana, Guardia Nacional, INM, SADER y SEDENA','SADER y AFAC únicamente','Ninguna de las anteriores','B',1),
('¿Qué se debe cumplir para ingresar a una zona restringida?','Contar con una TIA vigente','Tener autorización para esa zona','Pasar revisión de la persona y sus pertenencias','Todas las anteriores','D',1),
('¿Qué es seguridad aeroportuaria?','Combinación de medidas y recursos humanos y materiales para salvaguardar la aviación civil contra actos de interferencia ilícita','Medidas para evitar el ingreso de pasajeros','Leyes para sancionar trabajadores',NULL,'A',1),
('¿Qué es un acto de interferencia ilícita?','Una medida para mantener la operación del aeropuerto','Una regla para abordar una aeronave','Un acto o tentativa destinado a comprometer la seguridad de la aviación civil y del transporte aéreo',NULL,'C',1),
('¿Cómo se integra el Programa de Seguridad del Aeropuerto?','Plan operacional y plan de seguridad nacional','Plan de seguridad y plan de organización','Plan de seguridad y plan de contingencia',NULL,'C',1),
('¿Qué significa TIAV?','Tarjeta de Identificación Aerovehicular','Tarjeta de Identificación Aeroportuaria Vehicular','Tarjeta Vehicular',NULL,'B',1),
('¿Cuál es el objetivo del Plan de Contingencia?','Definir una ruta para desalojar el aeropuerto','Enseñar exclusivamente el uso de extintores','Establecer medidas que refuercen la prevención de actos de interferencia ilícita',NULL,'C',1),
('¿Quién determina a nivel local el incremento o decremento del nivel de contingencia?','El administrador del aeropuerto','El comandante de la AFAC','Las líneas aéreas',NULL,'A',1),
('¿Qué normatividades se deben seguir como bases legales?','Nacionales e internacionales','Internacionales y municipales','Mundiales y municipales',NULL,'A',1),
('¿A quién debes avisar al recibir una amenaza telefónica o personal?','Al personal de aerolíneas','Al personal de limpieza','A la administración mediante seguridad o las autoridades destacadas',NULL,'C',1),
('¿Quiénes integran la organización de seguridad del aeropuerto?','Administrador, jefatura y coordinación de seguridad, PIP, seguridad contratada, revisión de equipaje documentado y CCTV','Únicamente jefatura y seguridad contratada','Únicamente PIP y CCTV',NULL,'A',1),
('¿Cómo se debe portar la TIA?','Visible, en portatarjeta con cordón, broche o brazalete autorizado','Solo al cruzar un acceso','Oculta bajo la ropa',NULL,'A',1),
('¿Cómo deben introducirse líquidos, aerosoles y geles?','Con TIA roja','En envases menores de 150 ml','En envases mayores a un litro','En envases de hasta 100 ml dentro de una bolsa transparente de 20 x 20 cm','D',2),
('¿Qué debe hacerse en caso de extravío o sustracción de la TIA?','Comunicarlo inmediatamente a la oficina de seguridad del aeropuerto','Continuar laborando normalmente','Esperar hasta el siguiente día','No reportarlo','A',2),
('¿Cómo se dividen las infracciones por mal uso de la TIA?','Faltas leves','Faltas graves','Faltas leves y graves',NULL,'C',2),
('¿Cómo se conforma la normatividad nacional de seguridad aeroportuaria?','Ley de Aviación Civil y Ley de Aeropuertos','Programa Nacional de Seguridad Aeroportuaria y circulares obligatorias','Todas las anteriores',NULL,'C',2),
('¿Cuáles son las dos áreas generales de la seguridad aeroportuaria?','Seguridad contra actos de interferencia ilícita y seguridad operacional','Seguridad operacional y seguridad judicial','Seguridad laboral y seguridad judicial',NULL,'A',2),
('¿Quién aplica la sanción por el mal uso de la Tarjeta de Identificación Aeroportuaria?','La administración del aeropuerto','La policía municipal','El personal de limpieza',NULL,'A',2),
('¿Cuáles situaciones deben notificarse?','Detectar una persona sin TIA','Detectar un objeto abandonado','Observar actos vandálicos','Todas las anteriores','D',3),
('¿Cuáles son artículos prohibidos?','Cinturón','Navaja, aerosol y desarmador','Reloj y pulsera','Todas las anteriores','B',3),
('¿Cuál es una falta leve relacionada con el uso de la TIA?','Portar la tarjeta oculta bajo la ropa','Ingresar a un área no autorizada','Utilizar una tarjeta vencida',NULL,'A',3),
('Como trabajador, ¿qué debes cumplir al ingresar a una zona controlada?','Pasar un control de seguridad','Permitir la inspección de tus pertenencias','Todas las anteriores',NULL,'C',3);
