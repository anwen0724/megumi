ALTER TABLE `session_message_attachments` ADD COLUMN `size_bytes` integer;
--> statement-breakpoint
ALTER TABLE `session_compactions` ADD COLUMN `usage` text;
