CREATE TABLE `memory_current_extractions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`source_version` text NOT NULL,
	FOREIGN KEY (`session_id`,`source_version`) REFERENCES `memory_extractions`(`session_id`,`source_version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memory_extractions` (
	`session_id` text NOT NULL,
	`source_version` text NOT NULL,
	`workspace_id` text,
	`source_updated_at` text NOT NULL,
	`raw_memory` text NOT NULL,
	`rollout_summary` text NOT NULL,
	`rollout_slug` text NOT NULL,
	`coverage_json` text NOT NULL,
	`extracted_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `source_version`),
	FOREIGN KEY (`session_id`) REFERENCES `memory_sources`(`session_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memory_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage` text NOT NULL,
	`session_id` text,
	`source_version` text,
	`target_revision` integer,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`owner_token` text,
	`lease_expires_at` text,
	`retry_at` text,
	`error_json` text,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `memory_runs`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_job_status" CHECK("memory_jobs"."status" IN ('pending','running','succeeded','failed','cancelled','superseded')),
	CONSTRAINT "memory_job_attempt" CHECK("memory_jobs"."attempt" > 0),
	CONSTRAINT "memory_job_stage" CHECK("memory_jobs"."stage" IN ('extract','consolidate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_active_extraction` ON `memory_jobs` (`session_id`,`source_version`) WHERE "memory_jobs"."stage" = 'extract' AND "memory_jobs"."status" IN ('pending','running');--> statement-breakpoint
CREATE UNIQUE INDEX `memory_active_consolidation` ON `memory_jobs` (`stage`) WHERE "memory_jobs"."stage" = 'consolidate' AND "memory_jobs"."status" IN ('pending','running');--> statement-breakpoint
CREATE TABLE `memory_requests` (
	`operation` text NOT NULL,
	`request_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`operation`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `memory_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`target_revision` integer NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`result_json` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT "memory_run_status" CHECK("memory_runs"."status" IN ('pending','running','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE `memory_snapshot_sources` (
	`snapshot_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source_version` text NOT NULL,
	`ordinal` integer NOT NULL,
	`artifact_path` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `session_id`, `source_version`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `memory_snapshots`(`snapshot_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`,`source_version`) REFERENCES `memory_extractions`(`session_id`,`source_version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memory_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`target_revision` integer NOT NULL,
	`diff_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_sources` (
	`session_id` text PRIMARY KEY NOT NULL,
	`eligibility` text DEFAULT 'eligible' NOT NULL,
	`eligibility_version` integer DEFAULT 0 NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "memory_source_eligibility" CHECK("memory_sources"."eligibility" IN ('eligible', 'excluded')),
	CONSTRAINT "memory_source_counters" CHECK("memory_sources"."eligibility_version" >= 0 AND "memory_sources"."usage_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `memory_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`artifact_state` text DEFAULT 'empty' NOT NULL,
	`control_revision` integer DEFAULT 0 NOT NULL,
	`dirty_revision` integer DEFAULT 0 NOT NULL,
	`processed_revision` integer DEFAULT 0 NOT NULL,
	`successful_snapshot_id` text,
	`artifact_versions_json` text DEFAULT '{}' NOT NULL,
	`clear_pending` integer DEFAULT false NOT NULL,
	`reply_cursor` integer DEFAULT 0 NOT NULL,
	`clear_reply_cursor` integer DEFAULT 0 NOT NULL,
	`writer_token` text,
	`writer_lease_expires_at` text,
	FOREIGN KEY (`successful_snapshot_id`) REFERENCES `memory_snapshots`(`snapshot_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_singleton" CHECK("memory_state"."id" = 1),
	CONSTRAINT "memory_artifact_state" CHECK("memory_state"."artifact_state" IN ('empty','ready','updating','needsRepair','clearing')),
	CONSTRAINT "memory_revisions" CHECK("memory_state"."control_revision" >= 0 AND "memory_state"."dirty_revision" >= "memory_state"."processed_revision" AND "memory_state"."processed_revision" >= 0)
);
--> statement-breakpoint
INSERT INTO memory_state (id) VALUES (1);
