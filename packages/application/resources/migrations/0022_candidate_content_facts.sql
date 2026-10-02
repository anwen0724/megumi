UPDATE `discovery_recommendations`
SET `candidate_id` = NULL;--> statement-breakpoint
DROP TABLE `discovery_candidate_interest_matches`;--> statement-breakpoint
DROP TABLE `discovery_candidates`;--> statement-breakpoint
CREATE TABLE `discovery_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`content_identity` text NOT NULL,
	`source_id` text NOT NULL,
	`source_content_id` text,
	`canonical_url` text NOT NULL,
	`content_type` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`published_at` text,
	`description` text,
	`content_summary` text NOT NULL,
	`content_excerpt` text,
	`content_truncated` integer DEFAULT 0 NOT NULL,
	`cover_url` text,
	`status` text DEFAULT 'available' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT `check_discovery_candidates_content_type` CHECK(`content_type` IN ('video', 'article', 'news', 'project', 'post', 'page', 'other')),
	CONSTRAINT `check_discovery_candidates_title` CHECK(length(trim(`title`)) > 0),
	CONSTRAINT `check_discovery_candidates_content_summary` CHECK(length(trim(`content_summary`)) BETWEEN 1 AND 1000),
	CONSTRAINT `check_discovery_candidates_content_excerpt` CHECK(`content_excerpt` IS NULL OR length(trim(`content_excerpt`)) > 0),
	CONSTRAINT `check_discovery_candidates_content_truncated` CHECK(`content_truncated` IN (0, 1)),
	CONSTRAINT `check_discovery_candidates_excerpt_shape` CHECK(`content_excerpt` IS NOT NULL OR `content_truncated` = 0),
	CONSTRAINT `check_discovery_candidates_status` CHECK(`status` IN ('available', 'consumed', 'expired')),
	CONSTRAINT `check_discovery_candidates_expiry` CHECK(`expires_at` > `created_at`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidates_content_identity` ON `discovery_candidates` (`content_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidates_canonical_url` ON `discovery_candidates` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidates_source_content` ON `discovery_candidates` (`source_id`, `source_content_id`) WHERE `source_content_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_discovery_candidates_status_expires` ON `discovery_candidates` (`status`, `expires_at`);--> statement-breakpoint
CREATE TABLE `discovery_candidate_interest_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`interest_id` text NOT NULL,
	`relevance` text NOT NULL,
	`match_reason` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `discovery_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interest_id`) REFERENCES `discovery_interests`(`interest_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `check_discovery_candidate_interest_matches_relevance` CHECK(`relevance` IN ('direct', 'adjacent', 'exploration')),
	CONSTRAINT `check_discovery_candidate_interest_matches_reason` CHECK(length(trim(`match_reason`)) BETWEEN 1 AND 1000)
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidate_interest_matches_pair` ON `discovery_candidate_interest_matches` (`candidate_id`, `interest_id`);--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_interest_matches_interest` ON `discovery_candidate_interest_matches` (`interest_id`, `candidate_id`);
