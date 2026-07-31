DROP TABLE IF EXISTS `artifact_source_refs`;
--> statement-breakpoint
UPDATE `artifacts` SET `current_version_id` = NULL;
--> statement-breakpoint
DROP TABLE IF EXISTS `artifact_versions`;
--> statement-breakpoint
DROP TABLE IF EXISTS `artifacts`;
--> statement-breakpoint
DROP TABLE IF EXISTS `memory_markdown_mirrors`;
--> statement-breakpoint
UPDATE `memory_records` SET `superseded_by_id` = NULL;
--> statement-breakpoint
DROP TABLE IF EXISTS `memory_records`;
