PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_candidate_supply_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`source_cooldowns` text NOT NULL,
	`search_backoff` text NOT NULL,
	`supplement_requests` text DEFAULT '[]' NOT NULL,
	`candidate_next_interest_id` text,
	`daily_feed_next_interest_id` text,
	`last_finished_at` integer,
	CONSTRAINT "check_candidate_supply_state_1" CHECK(id = 1),
	CONSTRAINT "check_candidate_supply_state_2" CHECK(json_valid(source_cooldowns)),
	CONSTRAINT "check_candidate_supply_state_3" CHECK(json_valid(search_backoff)),
	CONSTRAINT "check_candidate_supply_state_4" CHECK(json_valid(supplement_requests))
);
--> statement-breakpoint
INSERT INTO `__new_candidate_supply_state`("id", "source_cooldowns", "search_backoff", "supplement_requests", "candidate_next_interest_id", "daily_feed_next_interest_id", "last_finished_at") SELECT "id", "source_cooldowns", "search_backoff", '[]', "candidate_next_interest_id", "daily_feed_next_interest_id", "last_finished_at" FROM `candidate_supply_state`;--> statement-breakpoint
DROP TABLE `candidate_supply_state`;--> statement-breakpoint
ALTER TABLE `__new_candidate_supply_state` RENAME TO `candidate_supply_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
