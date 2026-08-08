CREATE TABLE `__new_session_compactions` (
	`compaction_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`anchor_entry_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`summary_text` text,
	`covered_until_entry_id` text,
	`first_kept_entry_id` text,
	`usage` text,
	`error_code` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_compactions` (
	`compaction_id`, `session_id`, `anchor_entry_id`, `trigger`, `status`,
	`summary_text`, `covered_until_entry_id`, `first_kept_entry_id`, `usage`,
	`error_code`, `error_message`, `started_at`, `completed_at`
)
SELECT
	`compaction_id`, `session_id`, `covered_until_entry_id`, 'legacy', 'completed',
	`summary_text`, `covered_until_entry_id`, `first_kept_entry_id`, `usage`,
	NULL, NULL, `created_at`, `created_at`
FROM `session_compactions`;
--> statement-breakpoint
CREATE TEMP TABLE `__session_compaction_entry_links` AS
SELECT `entry_id`, `compaction_id`
FROM `session_entries`
WHERE `compaction_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `session_entries`
SET `compaction_id` = NULL
WHERE `compaction_id` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `session_compactions`;
--> statement-breakpoint
ALTER TABLE `__new_session_compactions` RENAME TO `session_compactions`;
--> statement-breakpoint
CREATE INDEX `idx_session_compactions_session_started`
ON `session_compactions` (`session_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_session_compactions_session_status`
ON `session_compactions` (`session_id`,`status`);
--> statement-breakpoint
UPDATE `session_entries`
SET `compaction_id` = (
	SELECT `link`.`compaction_id`
	FROM `__session_compaction_entry_links` AS `link`
	WHERE `link`.`entry_id` = `session_entries`.`entry_id`
)
WHERE `entry_id` IN (SELECT `entry_id` FROM `__session_compaction_entry_links`);
--> statement-breakpoint
DROP TABLE `__session_compaction_entry_links`;
