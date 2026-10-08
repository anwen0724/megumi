CREATE TABLE `memory_usage_receipts` (
	`reply_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source_version` text NOT NULL,
	`status` text NOT NULL,
	`used_at` text NOT NULL,
	PRIMARY KEY(`reply_id`, `session_id`),
	CONSTRAINT "memory_usage_status" CHECK("memory_usage_receipts"."status" IN ('pending','counted','ignored'))
);
