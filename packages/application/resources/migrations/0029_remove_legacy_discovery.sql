-- Removes the eleven legacy discovery tables. The switch is complete: the
-- production entry points read and write only the Candidate Supply tables
-- created by 0028, so these tables and their data are dropped in one migration.
-- Settings, credentials and unrelated data are not touched.
DROP TABLE IF EXISTS `discovery_interest_evidence`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidate_interest_matches`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_preference_evidence`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_preferences`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_preference_sets`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_recommendation_contents`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_recommendation_states`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_recommendations`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_candidates`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_interest_session_settings`;--> statement-breakpoint
DROP TABLE IF EXISTS `discovery_interests`;
