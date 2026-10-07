ALTER TABLE `content_interest_matches` ADD `interest_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `interests` ADD `revision` integer DEFAULT 1 NOT NULL;