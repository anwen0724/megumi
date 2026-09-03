-- A persisted Message or applied Compaction occupies at most one Entry Tree node.
-- Existing conflicts fail this migration; no historical path is rewritten silently.
CREATE UNIQUE INDEX `idx_session_entries_message_identity`
ON `session_entries` (`message_id`)
WHERE `entry_type` = 'message' AND `message_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_entries_compaction_identity`
ON `session_entries` (`compaction_id`)
WHERE `entry_type` = 'compaction' AND `compaction_id` IS NOT NULL;
