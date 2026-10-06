-- Removes the eleven legacy discovery tables.
-- Registered in meta/_journal.json together with the supply switch (B6); until
-- then the script is verified against an isolated database and is not applied
-- to a product database, so the legacy code keeps working.

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
DROP TABLE IF EXISTS `discovery_interests`;--> statement-breakpoint
