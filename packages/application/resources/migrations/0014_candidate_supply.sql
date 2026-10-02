CREATE TABLE `discovery_candidate_queries` (
	`query_id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`query_key` text NOT NULL,
	`source_id` text NOT NULL,
	`query_text` text NOT NULL,
	`normalized_query` text NOT NULL,
	`mode` text NOT NULL,
	`target_interest_ids_json` text NOT NULL,
	`status` text NOT NULL,
	`raw_result_count` integer DEFAULT 0 NOT NULL,
	`invalid_result_count` integer DEFAULT 0 NOT NULL,
	`new_candidate_count` integer DEFAULT 0 NOT NULL,
	`merged_candidate_count` integer DEFAULT 0 NOT NULL,
	`already_recommended_count` integer DEFAULT 0 NOT NULL,
	`capacity_rejected_count` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT `check_discovery_candidate_queries_mode` CHECK(`mode` IN ('relevance', 'recent')),
	CONSTRAINT `check_discovery_candidate_queries_status` CHECK(`status` IN ('running', 'succeeded', 'failed', 'cancelled', 'interrupted'))
);
--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_queries_execution` ON `discovery_candidate_queries` (`execution_id`);--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_queries_key_completed` ON `discovery_candidate_queries` (`query_key`,`completed_at`);--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_queries_source_completed` ON `discovery_candidate_queries` (`source_id`,`completed_at`);--> statement-breakpoint

CREATE TABLE `discovery_candidates` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`content_identity` text NOT NULL,
	`status` text NOT NULL,
	`primary_source_id` text NOT NULL,
	`primary_source_name` text NOT NULL,
	`source_content_id` text,
	`canonical_url` text NOT NULL,
	`content_type` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`content_published_at` text,
	`description` text,
	`content_text` text,
	`cover_url` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`status_updated_at` text NOT NULL,
	CONSTRAINT `check_discovery_candidates_status` CHECK(`status` IN ('preparing', 'pending_admission', 'available', 'reserved', 'consumed', 'rejected', 'expired')),
	CONSTRAINT `check_discovery_candidates_content_type` CHECK(`content_type` IN ('video', 'article', 'news', 'project', 'post', 'page', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidates_content_identity` ON `discovery_candidates` (`content_identity`);--> statement-breakpoint
CREATE INDEX `idx_discovery_candidates_status_expires` ON `discovery_candidates` (`status`,`expires_at`);--> statement-breakpoint

CREATE TABLE `discovery_candidate_sources` (
	`candidate_source_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`source_identity` text NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`source_content_id` text,
	`canonical_url` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `discovery_candidates`(`candidate_id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidate_sources_identity` ON `discovery_candidate_sources` (`source_identity`);--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_sources_candidate` ON `discovery_candidate_sources` (`candidate_id`);--> statement-breakpoint

CREATE TABLE `discovery_candidate_query_results` (
	`query_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`result_kind` text NOT NULL,
	PRIMARY KEY (`query_id`,`candidate_id`),
	FOREIGN KEY (`query_id`) REFERENCES `discovery_candidate_queries`(`query_id`) ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `discovery_candidates`(`candidate_id`) ON DELETE cascade,
	CONSTRAINT `check_discovery_candidate_query_results_kind` CHECK(`result_kind` IN ('created', 'merged'))
);
--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_query_results_candidate` ON `discovery_candidate_query_results` (`candidate_id`);--> statement-breakpoint

CREATE TABLE `discovery_candidate_assessments` (
	`assessment_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`execution_id` text NOT NULL,
	`assessment_version` text NOT NULL,
	`decision` text NOT NULL,
	`relevance` text,
	`matched_interest_ids_json` text NOT NULL,
	`content_value` text,
	`novelty` text,
	`temporal_validity` text,
	`negative_constraint` text,
	`duplicate_of_candidate_id` text,
	`duplicate_of_recommendation_id` text,
	`reason_code` text,
	`reason` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`assessed_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `discovery_candidates`(`candidate_id`) ON DELETE cascade,
	FOREIGN KEY (`duplicate_of_candidate_id`) REFERENCES `discovery_candidates`(`candidate_id`),
	FOREIGN KEY (`duplicate_of_recommendation_id`) REFERENCES `discovery_recommendations`(`recommendation_id`),
	CONSTRAINT `check_discovery_candidate_assessments_decision` CHECK(`decision` IN ('admit', 'needs_detail', 'reject')),
	CONSTRAINT `check_discovery_candidate_assessments_active` CHECK(`active` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidate_assessments_active` ON `discovery_candidate_assessments` (`candidate_id`) WHERE `active` = 1;--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_assessments_execution` ON `discovery_candidate_assessments` (`execution_id`);--> statement-breakpoint

CREATE TABLE `discovery_candidate_interests` (
	`candidate_id` text NOT NULL,
	`interest_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`relation_kind` text NOT NULL,
	PRIMARY KEY (`candidate_id`,`interest_id`),
	FOREIGN KEY (`candidate_id`) REFERENCES `discovery_candidates`(`candidate_id`) ON DELETE cascade,
	FOREIGN KEY (`interest_id`) REFERENCES `discovery_interests`(`interest_id`) ON DELETE cascade,
	FOREIGN KEY (`assessment_id`) REFERENCES `discovery_candidate_assessments`(`assessment_id`) ON DELETE cascade,
	CONSTRAINT `check_discovery_candidate_interests_relation` CHECK(`relation_kind` IN ('direct', 'adjacent'))
);
--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_interests_interest` ON `discovery_candidate_interests` (`interest_id`,`candidate_id`);--> statement-breakpoint

CREATE TABLE `discovery_candidate_supply_state` (
	`state_id` text PRIMARY KEY NOT NULL,
	`consecutive_zero_yield_count` integer DEFAULT 0 NOT NULL,
	`retry_at` text,
	`next_recheck_at` text,
	`last_settlement_json` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `check_discovery_candidate_supply_state_singleton` CHECK(`state_id` = 'candidate_supply')
);
--> statement-breakpoint
CREATE TABLE `discovery_candidate_source_state` (
	`source_id` text PRIMARY KEY NOT NULL,
	`consecutive_failure_count` integer DEFAULT 0 NOT NULL,
	`retry_at` text,
	`last_failure_code` text,
	`updated_at` text NOT NULL
);
