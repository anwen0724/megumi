CREATE TABLE `discovery_batches` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`status` text NOT NULL,
	`execution_id` text NOT NULL,
	`target_count` integer NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`automatic_retry_count` integer DEFAULT 0 NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text NOT NULL,
	`published_at` text,
	CONSTRAINT "check_discovery_batches_status" CHECK("discovery_batches"."status" IN ('running', 'published', 'failed')),
	CONSTRAINT "check_discovery_batches_target_count" CHECK("discovery_batches"."target_count" BETWEEN 1 AND 100),
	CONSTRAINT "check_discovery_batches_attempt_count" CHECK("discovery_batches"."attempt_count" >= 1),
	CONSTRAINT "check_discovery_batches_automatic_retry_count" CHECK("discovery_batches"."automatic_retry_count" BETWEEN 0 AND 2),
	CONSTRAINT "check_discovery_batches_result_count" CHECK("discovery_batches"."result_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_batches_local_date` ON `discovery_batches` (`local_date`);--> statement-breakpoint
CREATE INDEX `idx_discovery_batches_status` ON `discovery_batches` (`status`);--> statement-breakpoint
CREATE INDEX `idx_discovery_batches_published_at` ON `discovery_batches` (`published_at`);--> statement-breakpoint
CREATE TABLE `discovery_interest_evidence` (
	`evidence_id` text PRIMARY KEY NOT NULL,
	`interest_id` text,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`description` text NOT NULL,
	`effect` text NOT NULL,
	`confidence` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`applied_at` text,
	`retracted_at` text,
	FOREIGN KEY (`interest_id`) REFERENCES `discovery_interests`(`interest_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `session_messages`(`message_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_discovery_interest_evidence_description" CHECK(length(trim("discovery_interest_evidence"."description")) BETWEEN 1 AND 1000),
	CONSTRAINT "check_discovery_interest_evidence_effect" CHECK("discovery_interest_evidence"."effect" IN ('support', 'reject')),
	CONSTRAINT "check_discovery_interest_evidence_confidence" CHECK("discovery_interest_evidence"."confidence" IN ('high', 'medium')),
	CONSTRAINT "check_discovery_interest_evidence_status" CHECK("discovery_interest_evidence"."status" IN ('pending', 'applied', 'retracted'))
);
--> statement-breakpoint
CREATE INDEX `idx_discovery_interest_evidence_interest_status` ON `discovery_interest_evidence` (`interest_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_discovery_interest_evidence_session_status` ON `discovery_interest_evidence` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_discovery_interest_evidence_message` ON `discovery_interest_evidence` (`message_id`);--> statement-breakpoint
CREATE TABLE `discovery_interests` (
	`interest_id` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`created_from` text NOT NULL,
	`user_managed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`paused_at` text,
	`deleted_at` text,
	CONSTRAINT "check_discovery_interests_description" CHECK(length(trim("discovery_interests"."description")) BETWEEN 1 AND 1000),
	CONSTRAINT "check_discovery_interests_status" CHECK("discovery_interests"."status" IN ('active', 'paused', 'deleted')),
	CONSTRAINT "check_discovery_interests_created_from" CHECK("discovery_interests"."created_from" IN ('manual', 'conversation'))
);
--> statement-breakpoint
CREATE INDEX `idx_discovery_interests_status_updated` ON `discovery_interests` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `discovery_recommendations` (
	`recommendation_id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`content_identity` text NOT NULL,
	`position` integer NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`content_type` text NOT NULL,
	`source_content_id` text,
	`author` text,
	`content_published_at` text,
	`description` text,
	`cover_url` text,
	`recommendation_reason` text NOT NULL,
	`reaction` text,
	`hidden_at` text,
	`favorite_at` text,
	`watch_later_at` text,
	`first_opened_at` text,
	`last_opened_at` text,
	`published_at` text NOT NULL,
	`state_updated_at` text,
	FOREIGN KEY (`batch_id`) REFERENCES `discovery_batches`(`batch_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_discovery_recommendations_position" CHECK("discovery_recommendations"."position" >= 0),
	CONSTRAINT "check_discovery_recommendations_source_id" CHECK(length(trim("discovery_recommendations"."source_id")) > 0),
	CONSTRAINT "check_discovery_recommendations_source_name" CHECK(length(trim("discovery_recommendations"."source_name")) > 0),
	CONSTRAINT "check_discovery_recommendations_canonical_url" CHECK(length(trim("discovery_recommendations"."canonical_url")) > 0),
	CONSTRAINT "check_discovery_recommendations_title" CHECK(length(trim("discovery_recommendations"."title")) > 0),
	CONSTRAINT "check_discovery_recommendations_content_type" CHECK("discovery_recommendations"."content_type" IN ('video', 'article', 'news', 'project', 'post', 'page', 'other')),
	CONSTRAINT "check_discovery_recommendations_reason" CHECK(length(trim("discovery_recommendations"."recommendation_reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "check_discovery_recommendations_reaction" CHECK("discovery_recommendations"."reaction" IS NULL OR "discovery_recommendations"."reaction" IN ('liked', 'disliked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_content_identity` ON `discovery_recommendations` (`content_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_batch_position` ON `discovery_recommendations` (`batch_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendations_published_at` ON `discovery_recommendations` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendations_favorite_at` ON `discovery_recommendations` (`favorite_at`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendations_watch_later_at` ON `discovery_recommendations` (`watch_later_at`);--> statement-breakpoint
CREATE TABLE `discovery_session_policies` (
	`session_id` text PRIMARY KEY NOT NULL,
	`participation` text NOT NULL,
	`effective_from` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_discovery_session_policies_participation" CHECK("discovery_session_policies"."participation" IN ('included', 'excluded'))
);
