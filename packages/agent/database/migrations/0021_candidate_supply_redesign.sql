UPDATE `discovery_recommendations`
SET `candidate_id` = NULL;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_supply_checks`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_query_results`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_interests`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_assessments`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_sources`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_queries`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_supply_state`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_source_state`;--> statement-breakpoint
CREATE TABLE `discovery_candidates_new` (
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
	`cover_url` text,
	`selection_reason` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT `check_discovery_candidates_content_type` CHECK(`content_type` IN ('video', 'article', 'news', 'project', 'post', 'page', 'other')),
	CONSTRAINT `check_discovery_candidates_title` CHECK(length(trim(`title`)) > 0),
	CONSTRAINT `check_discovery_candidates_selection_reason` CHECK(length(trim(`selection_reason`)) > 0),
	CONSTRAINT `check_discovery_candidates_status` CHECK(`status` IN ('available', 'consumed', 'expired')),
	CONSTRAINT `check_discovery_candidates_expiry` CHECK(`expires_at` > `created_at`)
);--> statement-breakpoint
ALTER TABLE `discovery_recommendations` RENAME TO `discovery_recommendations_legacy`;--> statement-breakpoint
ALTER TABLE `discovery_feedback_changes` RENAME TO `discovery_feedback_changes_legacy`;--> statement-breakpoint
CREATE TABLE `discovery_recommendations` (
	`recommendation_id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`candidate_id` text,
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
	`feedback_id` text,
	`feedback_revision` integer DEFAULT 0 NOT NULL,
	`learned_feedback_revision` integer DEFAULT 0 NOT NULL,
	`matched_interest_ids_json` text DEFAULT '[]' NOT NULL,
	`interest_revisions_json` text DEFAULT '{}' NOT NULL,
	`preference_revisions_json` text DEFAULT '{}' NOT NULL,
	`content_evidence_json` text DEFAULT '{}' NOT NULL,
	`hidden_at` text,
	`favorite_at` text,
	`watch_later_at` text,
	`first_opened_at` text,
	`last_opened_at` text,
	`published_at` text NOT NULL,
	`state_updated_at` text,
	FOREIGN KEY (`batch_id`) REFERENCES `discovery_batches`(`batch_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `discovery_candidates_new`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `check_discovery_recommendations_position` CHECK(`position` >= 0),
	CONSTRAINT `check_discovery_recommendations_source_id` CHECK(length(trim(`source_id`)) > 0),
	CONSTRAINT `check_discovery_recommendations_source_name` CHECK(length(trim(`source_name`)) > 0),
	CONSTRAINT `check_discovery_recommendations_canonical_url` CHECK(length(trim(`canonical_url`)) > 0),
	CONSTRAINT `check_discovery_recommendations_title` CHECK(length(trim(`title`)) > 0),
	CONSTRAINT `check_discovery_recommendations_content_type` CHECK(`content_type` IN ('video', 'article', 'news', 'project', 'post', 'page', 'other')),
	CONSTRAINT `check_discovery_recommendations_reason` CHECK(length(trim(`recommendation_reason`)) BETWEEN 1 AND 1000),
	CONSTRAINT `check_discovery_recommendations_reaction` CHECK(`reaction` IS NULL OR `reaction` IN ('liked', 'disliked'))
);--> statement-breakpoint
INSERT INTO `discovery_recommendations` (
	`recommendation_id`, `batch_id`, `candidate_id`, `content_identity`, `position`,
	`source_id`, `source_name`, `canonical_url`, `title`, `content_type`,
	`source_content_id`, `author`, `content_published_at`, `description`, `cover_url`,
	`recommendation_reason`, `reaction`, `feedback_id`, `feedback_revision`,
	`learned_feedback_revision`,
	`matched_interest_ids_json`, `interest_revisions_json`, `preference_revisions_json`,
	`content_evidence_json`, `hidden_at`, `favorite_at`, `watch_later_at`,
	`first_opened_at`, `last_opened_at`, `published_at`, `state_updated_at`
)
SELECT
	`recommendation_id`, `batch_id`, NULL, `content_identity`, `position`,
	`source_id`, `source_name`, `canonical_url`, `title`, `content_type`,
	`source_content_id`, `author`, `content_published_at`, `description`, `cover_url`,
	`recommendation_reason`, `reaction`, `feedback_id`, `feedback_revision`,
	`learned_feedback_revision`,
	`matched_interest_ids_json`, `interest_revisions_json`, `preference_revisions_json`,
	`content_evidence_json`, `hidden_at`, `favorite_at`, `watch_later_at`,
	`first_opened_at`, `last_opened_at`, `published_at`, `state_updated_at`
FROM `discovery_recommendations_legacy`;--> statement-breakpoint
CREATE TABLE `discovery_feedback_changes` (
	`feedback_change_id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`recommendation_id` text NOT NULL,
	`previous_reaction` text,
	`current_reaction` text,
	`feedback_revision` integer NOT NULL,
	`status` text NOT NULL,
	`requires_correction` integer DEFAULT 0 NOT NULL,
	`batch_id` text,
	`changed_at` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`recommendation_id`) REFERENCES `discovery_recommendations`(`recommendation_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `check_discovery_feedback_changes_previous_reaction` CHECK(`previous_reaction` IS NULL OR `previous_reaction` IN ('liked', 'disliked')),
	CONSTRAINT `check_discovery_feedback_changes_current_reaction` CHECK(`current_reaction` IS NULL OR `current_reaction` IN ('liked', 'disliked')),
	CONSTRAINT `check_discovery_feedback_changes_status` CHECK(`status` IN ('pending', 'batched', 'processed', 'superseded', 'ignored')),
	CONSTRAINT `check_discovery_feedback_changes_correction` CHECK(`requires_correction` IN (0, 1))
);--> statement-breakpoint
INSERT INTO `discovery_feedback_changes` (
	`feedback_change_id`, `feedback_id`, `recommendation_id`, `previous_reaction`,
	`current_reaction`, `feedback_revision`, `status`, `requires_correction`,
	`batch_id`, `changed_at`, `processed_at`
)
SELECT
	`feedback_change_id`, `feedback_id`, `recommendation_id`, `previous_reaction`,
	`current_reaction`, `feedback_revision`, `status`, `requires_correction`,
	`batch_id`, `changed_at`, `processed_at`
FROM `discovery_feedback_changes_legacy`;--> statement-breakpoint
DROP TABLE `discovery_feedback_changes_legacy`;--> statement-breakpoint
DROP TABLE `discovery_recommendations_legacy`;--> statement-breakpoint
DROP TABLE `discovery_candidates`;--> statement-breakpoint
ALTER TABLE `discovery_candidates_new` RENAME TO `discovery_candidates`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidates_content_identity` ON `discovery_candidates` (`content_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidates_canonical_url` ON `discovery_candidates` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidates_source_content` ON `discovery_candidates` (`source_id`, `source_content_id`) WHERE `source_content_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_discovery_candidates_status_expires` ON `discovery_candidates` (`status`, `expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_content_identity` ON `discovery_recommendations` (`content_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_candidate` ON `discovery_recommendations` (`candidate_id`) WHERE `candidate_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_feedback_id` ON `discovery_recommendations` (`feedback_id`) WHERE `feedback_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_batch_position` ON `discovery_recommendations` (`batch_id`, `position`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendations_published_at` ON `discovery_recommendations` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendations_favorite_at` ON `discovery_recommendations` (`favorite_at`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendations_watch_later_at` ON `discovery_recommendations` (`watch_later_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_feedback_changes_feedback_revision` ON `discovery_feedback_changes` (`feedback_id`, `feedback_revision`);--> statement-breakpoint
CREATE INDEX `idx_discovery_feedback_changes_pending` ON `discovery_feedback_changes` (`status`, `changed_at`);--> statement-breakpoint
CREATE TABLE `discovery_candidate_interest_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`interest_id` text NOT NULL,
	`relevance` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `discovery_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interest_id`) REFERENCES `discovery_interests`(`interest_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `check_discovery_candidate_interest_matches_relevance` CHECK(`relevance` IN ('direct', 'adjacent', 'exploration'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_candidate_interest_matches_pair` ON `discovery_candidate_interest_matches` (`candidate_id`, `interest_id`);--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_interest_matches_interest` ON `discovery_candidate_interest_matches` (`interest_id`, `candidate_id`);
