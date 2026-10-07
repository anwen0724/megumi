ALTER TABLE `content_materials` ADD `author_id` text;--> statement-breakpoint
ALTER TABLE `content_materials` ADD `language` text;
--> statement-breakpoint
DROP TRIGGER content_materials_immutable;
--> statement-breakpoint
UPDATE content_materials SET author_id=(SELECT author_id FROM contents WHERE current_material_id=content_materials.id),language=(SELECT language FROM contents WHERE current_material_id=content_materials.id) WHERE id IN (SELECT current_material_id FROM contents);
--> statement-breakpoint
CREATE TRIGGER content_materials_immutable BEFORE UPDATE ON content_materials BEGIN SELECT RAISE(ABORT,'Material versions are immutable'); END;
