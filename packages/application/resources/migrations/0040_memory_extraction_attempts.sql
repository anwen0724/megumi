DROP INDEX `memory_active_extraction`;--> statement-breakpoint
ALTER TABLE `memory_jobs` ADD `retry_group_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_jobs` ADD `retry_of_job_id` text;--> statement-breakpoint
ALTER TABLE `memory_jobs` ADD `result_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `memory_active_extraction` ON `memory_jobs` (`session_id`) WHERE "memory_jobs"."stage" = 'extract' AND "memory_jobs"."status" IN ('pending','running');