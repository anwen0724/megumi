ALTER TABLE `session_messages`
  ADD COLUMN `message_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE `session_messages`
SET `message_json` = CASE
  WHEN `role` = 'assistant' THEN json_object(
    'role', 'assistant',
    'content', json_array(json_object('type', 'text', 'text', `content_text`))
  )
  ELSE json_object(
    'role', 'user',
    'content', json_array(json_object('type', 'text', 'text', `content_text`))
  )
END;
