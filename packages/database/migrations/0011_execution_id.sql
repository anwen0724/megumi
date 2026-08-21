ALTER TABLE `session_messages` RENAME COLUMN `run_id` TO `execution_id`;
--> statement-breakpoint
DROP INDEX `idx_session_messages_run`;
--> statement-breakpoint
CREATE INDEX `idx_session_messages_execution` ON `session_messages` (`execution_id`);
--> statement-breakpoint
DROP INDEX `idx_session_messages_assistant_reply_run`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_messages_assistant_reply_execution` ON `session_messages` (`session_id`,`execution_id`) WHERE "session_messages"."message_kind" = 'assistant_reply';
--> statement-breakpoint
ALTER TABLE `workspace_changes` RENAME COLUMN `run_id` TO `execution_id`;
--> statement-breakpoint
DROP INDEX `idx_workspace_changes_run`;
--> statement-breakpoint
CREATE INDEX `idx_workspace_changes_execution` ON `workspace_changes` (`execution_id`);
