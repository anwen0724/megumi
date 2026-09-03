DROP TABLE `discovery_preference_direction_feedback`;--> statement-breakpoint
DELETE FROM `discovery_preference_directions`;--> statement-breakpoint
DELETE FROM `discovery_preference_scopes`;--> statement-breakpoint
DELETE FROM `discovery_preference_learning_batches`;--> statement-breakpoint
ALTER TABLE `discovery_preference_learning_batches` ADD `reaction_snapshots_json` text NOT NULL DEFAULT '[]';--> statement-breakpoint
DROP TABLE `discovery_feedback_changes`;--> statement-breakpoint
DROP TABLE `discovery_recommendations`;--> statement-breakpoint
DROP TABLE `discovery_batches`;--> statement-breakpoint
CREATE TABLE `discovery_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`content_identity` text NOT NULL,
	`local_date` text NOT NULL,
	`position` integer NOT NULL,
	`recommendation_reason` text NOT NULL,
	`selection_basis_json` text NOT NULL,
	`published_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `discovery_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `check_discovery_recommendations_position` CHECK(`position` >= 0),
	CONSTRAINT `check_discovery_recommendations_reason` CHECK(length(trim(`recommendation_reason`)) BETWEEN 1 AND 1000)
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_candidate` ON `discovery_recommendations` (`candidate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_content_identity` ON `discovery_recommendations` (`content_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_date_position` ON `discovery_recommendations` (`local_date`,`position`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendations_date` ON `discovery_recommendations` (`local_date`,`position`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendations_published_at` ON `discovery_recommendations` (`published_at`);--> statement-breakpoint
CREATE TABLE `discovery_recommendation_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`recommendation_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`source_content_id` text,
	`canonical_url` text NOT NULL,
	`content_type` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`content_published_at` text,
	`description` text,
	`content_summary` text NOT NULL,
	`content_excerpt` text,
	`content_truncated` integer DEFAULT 0 NOT NULL,
	`cover_url` text,
	FOREIGN KEY (`recommendation_id`) REFERENCES `discovery_recommendations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `check_discovery_recommendation_contents_source_id` CHECK(length(trim(`source_id`)) > 0),
	CONSTRAINT `check_discovery_recommendation_contents_source_name` CHECK(length(trim(`source_name`)) > 0),
	CONSTRAINT `check_discovery_recommendation_contents_url` CHECK(length(trim(`canonical_url`)) > 0),
	CONSTRAINT `check_discovery_recommendation_contents_type` CHECK(`content_type` IN ('video', 'article', 'news', 'project', 'post', 'page', 'other')),
	CONSTRAINT `check_discovery_recommendation_contents_title` CHECK(length(trim(`title`)) > 0),
	CONSTRAINT `check_discovery_recommendation_contents_summary` CHECK(length(trim(`content_summary`)) BETWEEN 1 AND 1000),
	CONSTRAINT `check_discovery_recommendation_contents_excerpt` CHECK(`content_excerpt` IS NULL OR length(trim(`content_excerpt`)) > 0),
	CONSTRAINT `check_discovery_recommendation_contents_truncated` CHECK(`content_truncated` IN (0, 1)),
	CONSTRAINT `check_discovery_recommendation_contents_excerpt_shape` CHECK(`content_excerpt` IS NOT NULL OR `content_truncated` = 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendation_contents_recommendation` ON `discovery_recommendation_contents` (`recommendation_id`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendation_contents_source` ON `discovery_recommendation_contents` (`source_id`,`recommendation_id`);--> statement-breakpoint
CREATE TABLE `discovery_recommendation_states` (
	`id` text PRIMARY KEY NOT NULL,
	`recommendation_id` text NOT NULL,
	`reaction` text,
	`reaction_revision` integer DEFAULT 0 NOT NULL,
	`reaction_changed_at` text,
	`learned_reaction` text,
	`learned_reaction_revision` integer DEFAULT 0 NOT NULL,
	`favorite_at` text,
	`watch_later_at` text,
	`hidden_at` text,
	`first_opened_at` text,
	`last_opened_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recommendation_id`) REFERENCES `discovery_recommendations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `check_discovery_recommendation_states_reaction` CHECK(`reaction` IS NULL OR `reaction` IN ('liked', 'disliked')),
	CONSTRAINT `check_discovery_recommendation_states_learned_reaction` CHECK(`learned_reaction` IS NULL OR `learned_reaction` IN ('liked', 'disliked')),
	CONSTRAINT `check_discovery_recommendation_states_revisions` CHECK(`reaction_revision` >= 0 AND `learned_reaction_revision` >= 0 AND `learned_reaction_revision` <= `reaction_revision`),
	CONSTRAINT `check_discovery_recommendation_states_reaction_zero` CHECK(`reaction_revision` > 0 OR (`reaction` IS NULL AND `reaction_changed_at` IS NULL AND `learned_reaction` IS NULL)),
	CONSTRAINT `check_discovery_recommendation_states_reaction_time` CHECK(`reaction_revision` = 0 OR `reaction_changed_at` IS NOT NULL),
	CONSTRAINT `check_discovery_recommendation_states_learned_matches_current` CHECK(`learned_reaction_revision` <> `reaction_revision` OR `learned_reaction` IS `reaction`),
	CONSTRAINT `check_discovery_recommendation_states_opened_shape` CHECK((`first_opened_at` IS NULL AND `last_opened_at` IS NULL) OR (`first_opened_at` IS NOT NULL AND `last_opened_at` IS NOT NULL AND `first_opened_at` <= `last_opened_at`))
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendation_states_recommendation` ON `discovery_recommendation_states` (`recommendation_id`);--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendation_states_favorite` ON `discovery_recommendation_states` (`favorite_at`) WHERE `favorite_at` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendation_states_watch_later` ON `discovery_recommendation_states` (`watch_later_at`) WHERE `watch_later_at` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_discovery_recommendation_states_pending_reaction` ON `discovery_recommendation_states` (`reaction_revision`,`learned_reaction_revision`);
--> statement-breakpoint
CREATE TABLE `discovery_preference_direction_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`direction_id` text NOT NULL,
	`recommendation_id` text NOT NULL,
	FOREIGN KEY (`direction_id`) REFERENCES `discovery_preference_directions`(`direction_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recommendation_id`) REFERENCES `discovery_recommendations`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_preference_direction_recommendations_pair` ON `discovery_preference_direction_recommendations` (`direction_id`,`recommendation_id`);--> statement-breakpoint
CREATE INDEX `idx_discovery_preference_direction_recommendations_recommendation` ON `discovery_preference_direction_recommendations` (`recommendation_id`);
