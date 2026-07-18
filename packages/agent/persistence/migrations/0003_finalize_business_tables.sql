CREATE TABLE IF NOT EXISTS `legacy_session_message_staging` (
  `message_id` text PRIMARY KEY NOT NULL,
  `entry_id` text NOT NULL UNIQUE,
  `session_id` text NOT NULL,
  `run_id` text NOT NULL,
  `role` text NOT NULL,
  `content_text` text NOT NULL,
  `message_json` text NOT NULL,
  `parent_entry_id` text,
  `reparent_entry_id` text,
  `created_at` text NOT NULL,
  `completed_at` text,
  `sort_order` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `session_messages` (
  `message_id`, `session_id`, `run_id`, `role`, `content_text`,
  `message_json`, `created_at`, `completed_at`
)
SELECT `message_id`, `session_id`, `run_id`, `role`, `content_text`,
       `message_json`, `created_at`, `completed_at`
FROM `legacy_session_message_staging`
ORDER BY `run_id`, `sort_order`;
--> statement-breakpoint
UPDATE `session_messages`
SET `message_json` = (
      SELECT `staged`.`message_json`
      FROM `legacy_session_message_staging` AS `staged`
      WHERE `staged`.`message_id` = `session_messages`.`message_id`
    ),
    `run_id` = (
      SELECT `staged`.`run_id`
      FROM `legacy_session_message_staging` AS `staged`
      WHERE `staged`.`message_id` = `session_messages`.`message_id`
    )
WHERE `message_id` IN (SELECT `message_id` FROM `legacy_session_message_staging`);
--> statement-breakpoint
INSERT OR IGNORE INTO `session_entries` (
  `entry_id`, `session_id`, `parent_entry_id`, `entry_type`,
  `message_id`, `compaction_id`, `created_at`
)
SELECT `entry_id`, `session_id`, `parent_entry_id`, 'message',
       `message_id`, NULL, `created_at`
FROM `legacy_session_message_staging`
ORDER BY `run_id`, `sort_order`;
--> statement-breakpoint
UPDATE `session_entries`
SET `parent_entry_id` = (
  SELECT `staged`.`parent_entry_id`
  FROM `legacy_session_message_staging` AS `staged`
  WHERE `staged`.`entry_id` = `session_entries`.`entry_id`
)
WHERE `entry_id` IN (SELECT `entry_id` FROM `legacy_session_message_staging`);
--> statement-breakpoint
UPDATE `sessions` AS `session`
SET `active_entry_id` = (
  SELECT `last`.`entry_id`
  FROM `legacy_session_message_staging` AS `last`
  WHERE `last`.`run_id` = (
    SELECT `first`.`run_id`
    FROM `legacy_session_message_staging` AS `first`
    WHERE `first`.`session_id` = `session`.`session_id`
      AND `first`.`parent_entry_id` = `session`.`active_entry_id`
    ORDER BY `first`.`sort_order`
    LIMIT 1
  )
  ORDER BY `last`.`sort_order` DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM `legacy_session_message_staging` AS `first`
  WHERE `first`.`session_id` = `session`.`session_id`
    AND `first`.`parent_entry_id` = `session`.`active_entry_id`
    AND NOT EXISTS (
      SELECT 1
      FROM `legacy_session_message_staging` AS `final`
      WHERE `final`.`run_id` = `first`.`run_id`
        AND `final`.`reparent_entry_id` IS NOT NULL
    )
);
--> statement-breakpoint
UPDATE `session_entries`
SET `parent_entry_id` = (
  SELECT `entry_id` FROM `legacy_session_message_staging`
  WHERE `reparent_entry_id` = `session_entries`.`entry_id`
  LIMIT 1
)
WHERE `entry_id` IN (
  SELECT `reparent_entry_id` FROM `legacy_session_message_staging`
  WHERE `reparent_entry_id` IS NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_messages_new` (
  `message_id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `run_id` text,
  `role` text NOT NULL,
  `message_json` text NOT NULL,
  `created_at` text NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `session_messages_new`
SELECT `message_id`, `session_id`, `run_id`, `role`, `message_json`, `created_at`, `completed_at`
FROM `session_messages`;
--> statement-breakpoint
CREATE TABLE `session_message_attachments_new` (
  `attachment_id` text PRIMARY KEY NOT NULL,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `type` text NOT NULL,
  `name` text,
  `mime_type` text,
  `source_type` text NOT NULL,
  `source_value` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`message_id`) REFERENCES `session_messages_new`(`message_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `session_message_attachments_new` SELECT * FROM `session_message_attachments`;
--> statement-breakpoint
DROP TABLE `session_message_attachments`;
--> statement-breakpoint
DROP TABLE `session_messages`;
--> statement-breakpoint
ALTER TABLE `session_messages_new` RENAME TO `session_messages`;
--> statement-breakpoint
ALTER TABLE `session_message_attachments_new` RENAME TO `session_message_attachments`;
--> statement-breakpoint
CREATE INDEX `idx_session_messages_session_created` ON `session_messages` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_session_messages_run` ON `session_messages` (`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_session_message_attachments_message` ON `session_message_attachments` (`message_id`);
--> statement-breakpoint
CREATE INDEX `idx_session_message_attachments_session` ON `session_message_attachments` (`session_id`);
--> statement-breakpoint
CREATE TABLE `workspace_changes_new` (
  `change_set_id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `session_id` text NOT NULL,
  `run_id` text NOT NULL,
  `status` text NOT NULL,
  `changed_file_count` integer NOT NULL,
  `created_at` text NOT NULL,
  `finalized_at` text,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `workspace_changes_new` SELECT * FROM `workspace_changes`;
--> statement-breakpoint
CREATE TABLE `workspace_changed_files_new` (
  `changed_file_id` text PRIMARY KEY NOT NULL,
  `change_set_id` text NOT NULL,
  `workspace_path` text NOT NULL,
  `change_kind` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`change_set_id`) REFERENCES `workspace_changes_new`(`change_set_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `workspace_changed_files_new` SELECT * FROM `workspace_changed_files`;
--> statement-breakpoint
DROP TABLE `workspace_changed_files`;
--> statement-breakpoint
DROP TABLE `workspace_changes`;
--> statement-breakpoint
ALTER TABLE `workspace_changes_new` RENAME TO `workspace_changes`;
--> statement-breakpoint
ALTER TABLE `workspace_changed_files_new` RENAME TO `workspace_changed_files`;
--> statement-breakpoint
CREATE INDEX `idx_workspace_changes_run` ON `workspace_changes` (`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_workspace_changes_workspace_created` ON `workspace_changes` (`workspace_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_workspace_changed_files_change` ON `workspace_changed_files` (`change_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_changed_files_change_path` ON `workspace_changed_files` (`change_set_id`,`workspace_path`);
--> statement-breakpoint
CREATE TABLE `artifacts_new` (
  `artifact_id` text PRIMARY KEY NOT NULL,
  `workspace_id` text,
  `session_id` text,
  `run_id` text,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `status` text NOT NULL,
  `current_version_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `deleted_at` text,
  `metadata_json` text,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`current_version_id`) REFERENCES `artifact_versions_new`(`artifact_version_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `artifact_versions_new` (
  `artifact_version_id` text PRIMARY KEY NOT NULL,
  `artifact_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `storage` text NOT NULL,
  `content_type` text NOT NULL,
  `content_format` text NOT NULL,
  `inline_text` text,
  `content_key` text,
  `mime_type` text,
  `size_bytes` integer,
  `sha256` text,
  `text_preview` text,
  `created_by_run_id` text,
  `created_at` text NOT NULL,
  `metadata_json` text,
  FOREIGN KEY (`artifact_id`) REFERENCES `artifacts_new`(`artifact_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `artifacts_new` (
  `artifact_id`, `workspace_id`, `session_id`, `run_id`, `kind`, `title`, `status`,
  `current_version_id`, `created_at`, `updated_at`, `deleted_at`, `metadata_json`
)
SELECT `artifact_id`, `workspace_id`, `session_id`, `run_id`, `kind`, `title`, `status`,
       NULL, `created_at`, `updated_at`, `deleted_at`, `metadata_json`
FROM `artifacts`;
--> statement-breakpoint
INSERT INTO `artifact_versions_new` SELECT * FROM `artifact_versions`;
--> statement-breakpoint
UPDATE `artifacts_new`
SET `current_version_id` = (
  SELECT `old`.`current_version_id`
  FROM `artifacts` AS `old`
  WHERE `old`.`artifact_id` = `artifacts_new`.`artifact_id`
);
--> statement-breakpoint
CREATE TABLE `artifact_source_refs_new` (
  `source_ref_id` text PRIMARY KEY NOT NULL,
  `artifact_id` text NOT NULL,
  `artifact_version_id` text,
  `source_kind` text NOT NULL,
  `source_id` text NOT NULL,
  `excerpt_preview` text,
  `created_at` text NOT NULL,
  `metadata_json` text,
  FOREIGN KEY (`artifact_id`) REFERENCES `artifacts_new`(`artifact_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`artifact_version_id`) REFERENCES `artifact_versions_new`(`artifact_version_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `artifact_source_refs_new` SELECT * FROM `artifact_source_refs`;
--> statement-breakpoint
DROP TABLE `artifact_source_refs`;
--> statement-breakpoint
DROP TABLE `artifact_versions`;
--> statement-breakpoint
DROP TABLE `artifacts`;
--> statement-breakpoint
ALTER TABLE `artifacts_new` RENAME TO `artifacts`;
--> statement-breakpoint
ALTER TABLE `artifact_versions_new` RENAME TO `artifact_versions`;
--> statement-breakpoint
ALTER TABLE `artifact_source_refs_new` RENAME TO `artifact_source_refs`;
--> statement-breakpoint
CREATE INDEX `idx_artifacts_session_updated` ON `artifacts` (`session_id`,`updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_artifact_version` ON `artifact_versions` (`artifact_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `idx_artifact_source_refs_artifact` ON `artifact_source_refs` (`artifact_id`);
--> statement-breakpoint
DROP TABLE IF EXISTS `skill_usage_record`;
--> statement-breakpoint
DROP TABLE IF EXISTS `memory_recall_traces`;
--> statement-breakpoint
DROP TABLE IF EXISTS `memory_capture_attempts`;
--> statement-breakpoint
DROP TABLE IF EXISTS `agent_run_runtime_events`;
--> statement-breakpoint
DROP TABLE IF EXISTS `agent_run_approval_requests`;
--> statement-breakpoint
DROP TABLE IF EXISTS `agent_runs`;
--> statement-breakpoint
DROP TABLE `legacy_session_message_staging`;
