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
