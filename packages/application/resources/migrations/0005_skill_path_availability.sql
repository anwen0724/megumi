DROP TABLE `skill_availability`;
--> statement-breakpoint
CREATE TABLE `skill_availability` (
  `skill_availability_id` text PRIMARY KEY NOT NULL,
  `skill_path` text NOT NULL,
  `available` integer NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_skill_availability_path` ON `skill_availability` (`skill_path`);
