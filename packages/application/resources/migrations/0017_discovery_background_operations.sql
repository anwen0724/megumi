CREATE TABLE `discovery_interest_understandings` (
	`interest_understanding_id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user_message_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`changed_interest_ids_json` text NOT NULL DEFAULT '[]',
	`evidence_ids_json` text NOT NULL DEFAULT '[]',
	`queued_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`failure_code` text,
	`failure_message` text,
	CONSTRAINT `check_discovery_interest_understandings_status` CHECK(`status` IN ('queued', 'running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT `check_discovery_interest_understandings_outcome` CHECK(`outcome` IS NULL OR `outcome` IN ('evidence_committed', 'no_durable_evidence'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_interest_understandings_execution`
ON `discovery_interest_understandings` (`execution_id`);--> statement-breakpoint
CREATE INDEX `idx_discovery_interest_understandings_status`
ON `discovery_interest_understandings` (`status`,`queued_at`);--> statement-breakpoint

CREATE TABLE `discovery_candidate_supply_checks` (
	`candidate_supply_check_id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`execution_id` text,
	`settlement_reason` text,
	`available_before` integer,
	`available_after` integer,
	`remaining_gap_json` text,
	`requested_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`failure_code` text,
	`failure_message` text,
	CONSTRAINT `check_discovery_candidate_supply_checks_trigger` CHECK(`trigger` IN ('startup', 'resume', 'interest_changed', 'configuration_changed', 'candidate_state_changed', 'consumer_shortfall', 'scheduled_recheck', 'evaluation')),
	CONSTRAINT `check_discovery_candidate_supply_checks_status` CHECK(`status` IN ('queued', 'running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT `check_discovery_candidate_supply_checks_reason` CHECK(`settlement_reason` IS NULL OR `settlement_reason` IN ('no_gap', 'cooldown', 'fulfilled', 'budget_exhausted', 'no_available_source', 'model_unavailable', 'zero_yield', 'agent_failed', 'cancelled'))
);--> statement-breakpoint
CREATE INDEX `idx_discovery_candidate_supply_checks_status`
ON `discovery_candidate_supply_checks` (`status`,`requested_at`);--> statement-breakpoint

ALTER TABLE `discovery_preference_learning_batches` ADD `result_revisions_json` text NOT NULL DEFAULT '[]';
