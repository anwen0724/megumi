CREATE TABLE `session_messages_final_reply` (
  `message_id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `run_id` text,
  `message_kind` text NOT NULL CHECK (`message_kind` IN ('user_message', 'model_response', 'tool_result', 'assistant_reply')),
  `message_json` text NOT NULL,
  `created_at` text NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `session_messages_final_reply` (
  `message_id`, `session_id`, `run_id`, `message_kind`, `message_json`, `created_at`, `completed_at`
)
SELECT
  `message_id`,
  `session_id`,
  `run_id`,
  CASE `role`
    WHEN 'user' THEN 'user_message'
    WHEN 'toolResult' THEN 'tool_result'
    ELSE 'model_response'
  END,
  CASE `role`
    WHEN 'user' THEN json_set(
      json_remove(`message_json`, '$.role'),
      '$.legacy_provenance', json_object('source', 'pre_final_reply_semantics')
    )
    WHEN 'toolResult' THEN json_object(
      'tool_call_id', json_extract(`message_json`, '$.toolCallId'),
      'tool_name', json_extract(`message_json`, '$.toolName'),
      'status', json_extract(`message_json`, '$.status'),
      'content', json_extract(`message_json`, '$.content'),
      'legacy_provenance', json_object('source', 'pre_final_reply_semantics')
    )
    ELSE json_set(
      json_remove(`message_json`, '$.role', '$.stopReason'),
      '$.outcome_status', 'incomplete',
      '$.reason_code', 'legacy_unknown',
      '$.legacy_provenance', json_object('source', 'pre_final_reply_semantics'),
      '$.stop_reason', COALESCE(json_extract(`message_json`, '$.stopReason'), 'legacy_unknown')
    )
  END,
  `created_at`,
  `completed_at`
FROM `session_messages`;
--> statement-breakpoint
CREATE TABLE `session_message_attachments_final_reply` (
  `attachment_id` text PRIMARY KEY NOT NULL,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `type` text NOT NULL,
  `name` text,
  `mime_type` text,
  `source_type` text NOT NULL,
  `source_value` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`message_id`) REFERENCES `session_messages_final_reply`(`message_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `session_message_attachments_final_reply`
SELECT * FROM `session_message_attachments`;
--> statement-breakpoint
DROP TABLE `session_message_attachments`;
--> statement-breakpoint
DROP TABLE `session_messages`;
--> statement-breakpoint
ALTER TABLE `session_messages_final_reply` RENAME TO `session_messages`;
--> statement-breakpoint
ALTER TABLE `session_message_attachments_final_reply` RENAME TO `session_message_attachments`;
--> statement-breakpoint
CREATE INDEX `idx_session_messages_session_created` ON `session_messages` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_session_messages_run` ON `session_messages` (`run_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_messages_assistant_reply_run`
ON `session_messages` (`session_id`,`run_id`) WHERE `message_kind` = 'assistant_reply';
--> statement-breakpoint
CREATE INDEX `idx_session_message_attachments_message` ON `session_message_attachments` (`message_id`);
--> statement-breakpoint
CREATE INDEX `idx_session_message_attachments_session` ON `session_message_attachments` (`session_id`);
