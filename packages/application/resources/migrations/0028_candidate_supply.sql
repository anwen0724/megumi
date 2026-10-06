CREATE TABLE `candidate_supply_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_finished_at` integer,
	`next_interest_id` text,
	`source_cooldowns` text NOT NULL,
	CONSTRAINT "check_candidate_supply_state_singleton" CHECK("candidate_supply_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `content_analysis` (
	`content_id` text PRIMARY KEY NOT NULL,
	`summary` text,
	`key_points` text,
	`topics` text,
	`entities` text,
	`content_type` text,
	`quality_score` real,
	`spam_score` real,
	`long_term_value` text,
	`embedding` text,
	`embedding_model` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retry_at` integer,
	`last_error_code` text,
	`analyzed_at` integer,
	`embedding_retry_at` integer,
	`embedding_error_code` text,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_content_analysis_status" CHECK("content_analysis"."status" IN ('pending','ready','failed')),
	CONSTRAINT "check_content_analysis_attempts" CHECK("content_analysis"."attempts" >= 0),
	CONSTRAINT "check_content_analysis_ready" CHECK("content_analysis"."status" <> 'ready' OR "content_analysis"."analyzed_at" IS NOT NULL),
	CONSTRAINT "check_content_analysis_quality" CHECK("content_analysis"."quality_score" IS NULL OR ("content_analysis"."quality_score" >= 0 AND "content_analysis"."quality_score" <= 1)),
	CONSTRAINT "check_content_analysis_spam" CHECK("content_analysis"."spam_score" IS NULL OR ("content_analysis"."spam_score" >= 0 AND "content_analysis"."spam_score" <= 1)),
	CONSTRAINT "check_content_analysis_content_type" CHECK("content_analysis"."content_type" IS NULL OR "content_analysis"."content_type" IN ('news','article','discussion','video','paper','project','tutorial','opinion')),
	CONSTRAINT "check_content_analysis_long_term_value" CHECK("content_analysis"."long_term_value" IS NULL OR "content_analysis"."long_term_value" IN ('none','learning','reference','practical'))
);
--> statement-breakpoint
CREATE INDEX `idx_content_analysis_status_retry` ON `content_analysis` (`status`,`retry_at`);--> statement-breakpoint
CREATE TABLE `content_interest_matches` (
	`content_id` text NOT NULL,
	`interest_id` text NOT NULL,
	`relation` text NOT NULL,
	`basis` text,
	`matched_at` integer NOT NULL,
	PRIMARY KEY(`content_id`, `interest_id`),
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interest_id`) REFERENCES `interests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_content_interest_matches_relation" CHECK("content_interest_matches"."relation" IN ('direct','related','none'))
);
--> statement-breakpoint
CREATE INDEX `idx_content_interest_matches_interest` ON `content_interest_matches` (`interest_id`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text,
	`author` text,
	`published_at` integer,
	`text` text NOT NULL,
	`language` text,
	`duplicate_group_id` text,
	`duplicate_confidence` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`duplicate_group_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "check_contents_text" CHECK(length("contents"."text") > 0),
	CONSTRAINT "check_contents_duplicate_group" CHECK("contents"."duplicate_group_id" IS NULL OR "contents"."duplicate_group_id" <> "contents"."id"),
	CONSTRAINT "check_contents_duplicate_confidence" CHECK("contents"."duplicate_confidence" IS NULL OR ("contents"."duplicate_confidence" >= 0 AND "contents"."duplicate_confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contents_canonical_url_unique` ON `contents` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `idx_contents_published_at` ON `contents` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_contents_duplicate_group` ON `contents` (`duplicate_group_id`);--> statement-breakpoint
CREATE TABLE `interests` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "check_interests_text" CHECK(length(trim("interests"."text")) > 0)
);
--> statement-breakpoint
CREATE TABLE `recommendation_candidates` (
	`pool` text NOT NULL,
	`content_id` text NOT NULL,
	`status` text NOT NULL,
	`inactive_reason` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`pool`, `content_id`),
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_recommendation_candidates_pool" CHECK("recommendation_candidates"."pool" IN ('daily','long_term')),
	CONSTRAINT "check_recommendation_candidates_status" CHECK("recommendation_candidates"."status" IN ('active','inactive')),
	CONSTRAINT "check_recommendation_candidates_inactive_reason" CHECK(("recommendation_candidates"."status" = 'active' AND "recommendation_candidates"."inactive_reason" IS NULL) OR ("recommendation_candidates"."status" = 'inactive' AND "recommendation_candidates"."inactive_reason" IS NOT NULL AND "recommendation_candidates"."inactive_reason" IN ('expired','unrelated','excluded','unsuitable')))
);
--> statement-breakpoint
CREATE INDEX `idx_recommendation_candidates_pool_status_expires` ON `recommendation_candidates` (`pool`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `search_history` (
	`id` text PRIMARY KEY NOT NULL,
	`query_id` text NOT NULL,
	`source` text NOT NULL,
	`search_scope` text NOT NULL,
	`searched_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`result_count` integer,
	`new_item_count` integer,
	FOREIGN KEY (`query_id`) REFERENCES `search_queries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "check_search_history_outcome" CHECK("search_history"."outcome" IN ('success','failed')),
	CONSTRAINT "check_search_history_counts" CHECK(("search_history"."result_count" IS NULL OR "search_history"."result_count" >= 0) AND ("search_history"."new_item_count" IS NULL OR "search_history"."new_item_count" >= 0))
);
--> statement-breakpoint
CREATE INDEX `idx_search_history_query_source_time` ON `search_history` (`query_id`,`source`,`searched_at`);--> statement-breakpoint
CREATE TABLE `search_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`interest_id` text,
	`query` text NOT NULL,
	`category` text NOT NULL,
	`origin` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`interest_id`) REFERENCES `interests`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "check_search_queries_category" CHECK("search_queries"."category" IN ('core','entity','technical','exploratory','trend')),
	CONSTRAINT "check_search_queries_origin" CHECK("search_queries"."origin" IN ('ai','interest')),
	CONSTRAINT "check_search_queries_status" CHECK("search_queries"."status" IN ('active','retired')),
	CONSTRAINT "check_search_queries_length" CHECK(length("search_queries"."query") BETWEEN 1 AND 200),
	CONSTRAINT "check_search_queries_active_interest" CHECK("search_queries"."status" <> 'active' OR "search_queries"."interest_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_queries_active_identity` ON `search_queries` (`interest_id`,`query`) WHERE "search_queries"."status" = 'active';--> statement-breakpoint
CREATE INDEX `idx_search_queries_interest_status` ON `search_queries` (`interest_id`,`status`);--> statement-breakpoint
CREATE TABLE `search_results` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`url` text NOT NULL,
	`title` text,
	`description` text,
	`author` text,
	`published_at` integer,
	`raw_payload` text,
	`content_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retry_at` integer,
	`last_error_code` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "check_search_results_status" CHECK("search_results"."status" IN ('pending','normalized','rejected','failed')),
	CONSTRAINT "check_search_results_attempts" CHECK("search_results"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_results_source_url` ON `search_results` (`source`,`url`);--> statement-breakpoint
CREATE INDEX `idx_search_results_status_retry` ON `search_results` (`status`,`retry_at`);--> statement-breakpoint
CREATE INDEX `idx_search_results_content` ON `search_results` (`content_id`);