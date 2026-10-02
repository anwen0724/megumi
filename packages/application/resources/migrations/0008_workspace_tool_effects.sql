ALTER TABLE `workspace_changes` ADD COLUMN `effect_coverage` text NOT NULL DEFAULT 'complete';
--> statement-breakpoint
ALTER TABLE `workspace_changed_files` ADD COLUMN `effect_type` text NOT NULL DEFAULT 'modified';
--> statement-breakpoint
ALTER TABLE `workspace_changed_files` ADD COLUMN `source_workspace_path` text;
--> statement-breakpoint
ALTER TABLE `workspace_changed_files` ADD COLUMN `destination_workspace_path` text;
--> statement-breakpoint
ALTER TABLE `workspace_changed_files` ADD COLUMN `path_type` text NOT NULL DEFAULT 'file';
--> statement-breakpoint
ALTER TABLE `workspace_changed_files` ADD COLUMN `recoverable` integer;
--> statement-breakpoint
UPDATE `workspace_changed_files`
SET `effect_type` = CASE `change_kind`
  WHEN 'created' THEN 'created'
  WHEN 'deleted' THEN 'deleted'
  ELSE 'modified'
END;