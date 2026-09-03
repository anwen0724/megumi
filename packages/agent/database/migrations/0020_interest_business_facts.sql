CREATE TABLE `__new_discovery_session_policies` (
	`session_participation_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`participation` text NOT NULL,
	`effective_from` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_discovery_session_policies_participation" CHECK("participation" IN ('included', 'excluded'))
);--> statement-breakpoint
INSERT INTO `__new_discovery_session_policies` (
	`session_participation_id`, `session_id`, `participation`, `effective_from`, `updated_at`
)
SELECT
	'session-participation:' || lower(hex(randomblob(16))),
	`session_id`, `participation`, `effective_from`, `updated_at`
FROM `discovery_session_policies`;--> statement-breakpoint
DROP TABLE `discovery_session_policies`;--> statement-breakpoint
ALTER TABLE `__new_discovery_session_policies` RENAME TO `discovery_session_policies`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_session_policies_session`
ON `discovery_session_policies` (`session_id`);--> statement-breakpoint
DROP TABLE `discovery_interest_understandings`;
