DROP INDEX `idx_search_queries_active_identity`;--> statement-breakpoint
ALTER TABLE `search_queries` ADD `interest_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_queries_active_identity` ON `search_queries` (`interest_id`,`interest_revision`,`query`) WHERE "search_queries"."status" = 'active';
--> statement-breakpoint
CREATE TRIGGER retire_queries_on_interest_delete BEFORE DELETE ON interests BEGIN
  UPDATE search_queries SET status = 'retired' WHERE interest_id = OLD.id;
END;
