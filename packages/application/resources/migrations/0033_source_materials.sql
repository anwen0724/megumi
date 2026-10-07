CREATE TABLE `content_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text,
	`author` text,
	`text` text NOT NULL,
	`text_hash` text NOT NULL,
	`kind` text NOT NULL,
	`truncated` integer NOT NULL,
	`range_start` integer DEFAULT 0 NOT NULL,
	`range_end` integer NOT NULL,
	`method` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`publication_evidence` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_materials_revision" CHECK("content_materials"."revision" > 0),
	CONSTRAINT "check_materials_text" CHECK(length("content_materials"."text") > 0),
	CONSTRAINT "check_materials_kind" CHECK("content_materials"."kind" IN ('full_text','excerpt','description','transcript')),
	CONSTRAINT "check_materials_truncated" CHECK("content_materials"."truncated" IN (0,1)),
	CONSTRAINT "check_materials_range" CHECK("content_materials"."range_start" >= 0 AND "content_materials"."range_end" > "content_materials"."range_start")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_materials_content_revision` ON `content_materials` (`content_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_materials_id_content` ON `content_materials` (`id`,`content_id`);--> statement-breakpoint
CREATE TABLE `material_acquisitions` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`method` text NOT NULL,
	`acquired_at` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `content_materials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `contents` ADD `platform` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `contents` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `contents` ADD `author_id` text;--> statement-breakpoint
ALTER TABLE `contents` ADD `current_material_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contents_platform_external` ON `contents` (`platform`,`external_id`) WHERE "contents"."external_id" IS NOT NULL AND "contents"."external_id" <> '';
--> statement-breakpoint
UPDATE contents SET platform = CASE WHEN source IN ('zhihu','bilibili','xiaohongshu') THEN source ELSE 'web' END;
--> statement-breakpoint
INSERT INTO content_materials(id,content_id,revision,title,author,text,text_hash,kind,truncated,range_end,method,acquired_at,publication_evidence)
SELECT 'legacy:'||id,id,1,title,author,text,sha256(text),'excerpt',0,length(text),'legacy',created_at,
  json_array(json_object('kind',CASE WHEN source = 'zhihu' AND published_at IS NOT NULL THEN 'modified' ELSE 'unknown' END,
    'value',published_at,'precision',CASE WHEN published_at IS NULL THEN 'unknown' ELSE 'instant' END,'timezone','UTC',
    'location','legacy.contents.published_at','rawValue',CASE WHEN published_at IS NULL THEN NULL ELSE CAST(published_at AS TEXT) END,'status','unverified'))
FROM contents;
--> statement-breakpoint
UPDATE contents SET current_material_id = 'legacy:'||id;
--> statement-breakpoint
INSERT INTO material_acquisitions(id,material_id,method,acquired_at) SELECT 'legacy:'||id,'legacy:'||id,'legacy',created_at FROM contents;
--> statement-breakpoint
CREATE TRIGGER content_materials_immutable BEFORE UPDATE ON content_materials BEGIN SELECT RAISE(ABORT,'Material versions are immutable'); END;
