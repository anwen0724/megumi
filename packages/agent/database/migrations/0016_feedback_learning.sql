ALTER TABLE `discovery_interests` ADD `revision` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `feedback_id` text;--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `feedback_revision` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `learned_feedback_revision` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `assessment_id` text;--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `assessment_version` text;--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `matched_interest_ids_json` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `interest_revisions_json` text NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `preference_revisions_json` text NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `content_evidence_json` text NOT NULL DEFAULT '{}';--> statement-breakpoint
UPDATE `discovery_recommendations`
SET `feedback_id` = 'feedback:legacy:' || `recommendation_id`,
    `feedback_revision` = 1,
    `learned_feedback_revision` = 1
WHERE `reaction` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_feedback_id`
ON `discovery_recommendations` (`feedback_id`) WHERE `feedback_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `discovery_candidate_assessments` ADD `interest_revisions_json` text NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `discovery_candidate_assessments` ADD `preference_revisions_json` text NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `discovery_candidate_assessments` ADD `preference_alignment_json` text NOT NULL DEFAULT '{"status":"neutral","directionIds":[],"reason":"No Preference was available."}';--> statement-breakpoint
CREATE TABLE `discovery_feedback_changes` (
	`feedback_change_id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`recommendation_id` text NOT NULL,
	`previous_reaction` text,
	`current_reaction` text,
	`feedback_revision` integer NOT NULL,
	`status` text NOT NULL,
	`requires_correction` integer NOT NULL DEFAULT 0,
	`batch_id` text,
	`changed_at` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`recommendation_id`) REFERENCES `discovery_recommendations`(`recommendation_id`) ON DELETE cascade,
	CONSTRAINT `check_discovery_feedback_changes_previous_reaction` CHECK(`previous_reaction` IS NULL OR `previous_reaction` IN ('liked', 'disliked')),
	CONSTRAINT `check_discovery_feedback_changes_current_reaction` CHECK(`current_reaction` IS NULL OR `current_reaction` IN ('liked', 'disliked')),
	CONSTRAINT `check_discovery_feedback_changes_status` CHECK(`status` IN ('pending', 'batched', 'processed', 'superseded', 'ignored')),
	CONSTRAINT `check_discovery_feedback_changes_correction` CHECK(`requires_correction` IN (0, 1))
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_feedback_changes_feedback_revision`
ON `discovery_feedback_changes` (`feedback_id`,`feedback_revision`);--> statement-breakpoint
CREATE INDEX `idx_discovery_feedback_changes_pending`
ON `discovery_feedback_changes` (`status`,`changed_at`);--> statement-breakpoint
CREATE TABLE `discovery_preference_learning_batches` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`trigger_reason` text NOT NULL,
	`change_count` integer NOT NULL,
	`retry_count` integer NOT NULL DEFAULT 0,
	`retry_at` text,
	`created_at` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`failure_code` text,
	`failure_message` text,
	CONSTRAINT `check_discovery_preference_learning_batches_status` CHECK(`status` IN ('running', 'succeeded', 'failed')),
	CONSTRAINT `check_discovery_preference_learning_batches_trigger` CHECK(`trigger_reason` IN ('threshold', 'deadline', 'correction', 'retry')),
	CONSTRAINT `check_discovery_preference_learning_batches_change_count` CHECK(`change_count` BETWEEN 1 AND 20)
);--> statement-breakpoint
CREATE INDEX `idx_discovery_preference_learning_batches_status_retry`
ON `discovery_preference_learning_batches` (`status`,`retry_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `discovery_preference_scopes` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`interest_id` text,
	`revision` integer NOT NULL DEFAULT 0,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`interest_id`) REFERENCES `discovery_interests`(`interest_id`),
	CONSTRAINT `check_discovery_preference_scopes_scope` CHECK(`scope` IN ('interest', 'exploration')),
	CONSTRAINT `check_discovery_preference_scopes_shape` CHECK(
		(`scope` = 'interest' AND `interest_id` IS NOT NULL)
		OR (`scope` = 'exploration' AND `interest_id` IS NULL)
	)
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_preference_scopes_interest`
ON `discovery_preference_scopes` (`interest_id`) WHERE `interest_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `discovery_preference_directions` (
	`direction_id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`polarity` text NOT NULL,
	`dimension` text NOT NULL,
	`statement` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`scope_key`) REFERENCES `discovery_preference_scopes`(`scope_key`) ON DELETE cascade,
	CONSTRAINT `check_discovery_preference_directions_polarity` CHECK(`polarity` IN ('positive', 'negative')),
	CONSTRAINT `check_discovery_preference_directions_dimension` CHECK(`dimension` IN ('topic', 'source', 'author', 'content_type', 'recency', 'expression_quality')),
	CONSTRAINT `check_discovery_preference_directions_statement` CHECK(length(trim(`statement`)) BETWEEN 1 AND 1000)
);--> statement-breakpoint
CREATE INDEX `idx_discovery_preference_directions_scope`
ON `discovery_preference_directions` (`scope_key`);--> statement-breakpoint
CREATE TABLE `discovery_preference_direction_feedback` (
	`direction_id` text NOT NULL,
	`feedback_id` text NOT NULL,
	FOREIGN KEY (`direction_id`) REFERENCES `discovery_preference_directions`(`direction_id`) ON DELETE cascade,
	PRIMARY KEY (`direction_id`,`feedback_id`)
);--> statement-breakpoint
CREATE INDEX `idx_discovery_preference_direction_feedback_feedback`
ON `discovery_preference_direction_feedback` (`feedback_id`);
