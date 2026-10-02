CREATE TABLE `skill_availability` (
  `skill_availability_id` text PRIMARY KEY NOT NULL,
  `skill_id` text NOT NULL,
  `workspace_id` text,
  `available` integer NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_skill_availability_skill_workspace` ON `skill_availability` (`skill_id`,`workspace_id`);
--> statement-breakpoint
CREATE TABLE `skill_usage_record` (
  `skill_usage_record_id` text PRIMARY KEY NOT NULL,
  `skill_id` text NOT NULL,
  `workspace_id` text,
  `session_id` text NOT NULL,
  `run_id` text,
  `trigger_kind` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`run_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_skill_usage_record_session_created` ON `skill_usage_record` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_skill_usage_record_run_created` ON `skill_usage_record` (`run_id`,`created_at`);
