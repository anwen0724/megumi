-- Rebuild attachments so every message has a stable zero-based submission order.
CREATE TABLE `session_message_attachments_with_order` (
  `attachment_id` text PRIMARY KEY NOT NULL,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `type` text NOT NULL,
  `name` text,
  `mime_type` text,
  `source_type` text NOT NULL,
  `source_value` text NOT NULL,
  `ordinal` integer NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`message_id`) REFERENCES `session_messages`(`message_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `session_message_attachments_with_order` (
  `attachment_id`, `message_id`, `session_id`, `type`, `name`, `mime_type`,
  `source_type`, `source_value`, `ordinal`, `created_at`
)
SELECT
  `attachment`.`attachment_id`,
  `attachment`.`message_id`,
  `attachment`.`session_id`,
  `attachment`.`type`,
  `attachment`.`name`,
  `attachment`.`mime_type`,
  `attachment`.`source_type`,
  `attachment`.`source_value`,
  (
    SELECT COUNT(*) - 1
    FROM `session_message_attachments` AS `preceding`
    WHERE `preceding`.`message_id` = `attachment`.`message_id`
      AND (
        `preceding`.`created_at` < `attachment`.`created_at`
        OR (
          `preceding`.`created_at` = `attachment`.`created_at`
          AND `preceding`.`attachment_id` <= `attachment`.`attachment_id`
        )
      )
  ),
  `attachment`.`created_at`
FROM `session_message_attachments` AS `attachment`
ORDER BY `attachment`.`message_id`, `attachment`.`created_at`, `attachment`.`attachment_id`;
--> statement-breakpoint
DROP TABLE `session_message_attachments`;
--> statement-breakpoint
ALTER TABLE `session_message_attachments_with_order` RENAME TO `session_message_attachments`;
--> statement-breakpoint
CREATE INDEX `idx_session_message_attachments_message`
ON `session_message_attachments` (`message_id`);
--> statement-breakpoint
CREATE INDEX `idx_session_message_attachments_session`
ON `session_message_attachments` (`session_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_message_attachments_message_ordinal`
ON `session_message_attachments` (`message_id`, `ordinal`);
