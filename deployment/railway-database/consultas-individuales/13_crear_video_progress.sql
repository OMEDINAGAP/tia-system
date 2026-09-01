CREATE TABLE `video_progress` (
  `userId` bigint unsigned NOT NULL,
  `videoIndex` int NOT NULL,
  `progress` decimal(6,2) NOT NULL DEFAULT '0.00',
  `completed` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`userId`,`videoIndex`),
  CONSTRAINT `fk_video_progress_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
