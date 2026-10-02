ALTER TABLE `discovery_batches` ADD `requested_count` integer NOT NULL DEFAULT 1;--> statement-breakpoint
UPDATE `discovery_batches` SET `requested_count` = `target_count`;--> statement-breakpoint
ALTER TABLE `discovery_recommendations` ADD `candidate_id` text REFERENCES `discovery_candidates`(`candidate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_recommendations_candidate` ON `discovery_recommendations` (`candidate_id`) WHERE `candidate_id` IS NOT NULL;
