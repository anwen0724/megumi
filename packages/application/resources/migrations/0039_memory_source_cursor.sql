CREATE TABLE `session_reply_sequence` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `session_messages`(`message_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_reply_sequence_message_id_unique` ON `session_reply_sequence` (`message_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `content_updated_at` text;--> statement-breakpoint
UPDATE sessions SET content_updated_at = COALESCE(
  (SELECT MAX(COALESCE(completed_at, created_at)) FROM session_messages WHERE session_id = sessions.session_id), created_at);
--> statement-breakpoint
INSERT INTO session_reply_sequence (message_id)
SELECT message_id FROM session_messages WHERE message_kind = 'assistant_reply' ORDER BY rowid;
--> statement-breakpoint
CREATE TRIGGER session_reply_cursor_insert AFTER INSERT ON session_messages
WHEN NEW.message_kind = 'assistant_reply'
BEGIN
  INSERT INTO session_reply_sequence (message_id) VALUES (NEW.message_id);
END;
