CREATE TABLE `agent_loop_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`visibility` text NOT NULL,
	`created_at` text NOT NULL,
	`payload_json` text NOT NULL,
	`event_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_loop_events_run_sequence` ON `agent_loop_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `agent_loop_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`run_kind` text NOT NULL,
	`user_message_id` text,
	`assistant_message_id` text,
	`base_run_id` text,
	`base_message_id` text,
	`base_entry_id` text,
	`attempt_number` integer NOT NULL,
	`status` text NOT NULL,
	`permission_mode` text NOT NULL,
	`permission_snapshot_json` text,
	`memory_recall_trace_id` text,
	`started_at` text,
	`completed_at` text,
	`cancelled_at` text,
	`error_json` text,
	`created_at` text NOT NULL,
	`metadata_json` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_message_id`) REFERENCES `session_messages`(`message_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `session_messages`(`message_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`base_run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`base_message_id`) REFERENCES `session_messages`(`message_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`base_entry_id`) REFERENCES `session_entries`(`entry_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_loop_runs_session_created` ON `agent_loop_runs` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_loop_runs_workspace_created` ON `agent_loop_runs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_loop_runs_status` ON `agent_loop_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_loop_runs_user_message` ON `agent_loop_runs` (`user_message_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_loop_runs_assistant_message` ON `agent_loop_runs` (`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_loop_runs_base_run` ON `agent_loop_runs` (`base_run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_loop_runs_base_entry` ON `agent_loop_runs` (`base_entry_id`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`approval_request_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_scope` text NOT NULL,
	`risk_level` text NOT NULL,
	`request_json` text NOT NULL,
	`decision` text,
	`decided_by` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	`expires_at` text,
	`metadata_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_call_id`) REFERENCES `tool_calls`(`tool_call_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_approval_requests_run_status` ON `approval_requests` (`run_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_tool_call` ON `approval_requests` (`tool_call_id`);--> statement-breakpoint
CREATE TABLE `artifact_source_refs` (
	`source_ref_id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`artifact_version_id` text,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`excerpt_preview` text,
	`created_at` text NOT NULL,
	`metadata_json` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`artifact_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_version_id`) REFERENCES `artifact_versions`(`artifact_version_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_source_refs_artifact` ON `artifact_source_refs` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `artifact_versions` (
	`artifact_version_id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`storage` text NOT NULL,
	`content_type` text NOT NULL,
	`content_format` text NOT NULL,
	`inline_text` text,
	`content_key` text,
	`mime_type` text,
	`size_bytes` integer,
	`sha256` text,
	`text_preview` text,
	`created_by_run_id` text,
	`created_at` text NOT NULL,
	`metadata_json` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`artifact_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_artifact_version` ON `artifact_versions` (`artifact_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`session_id` text,
	`run_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`metadata_json` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`current_version_id`) REFERENCES `artifact_versions`(`artifact_version_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_session_updated` ON `artifacts` (`session_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `memory_capture_attempts` (
	`capture_attempt_id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`workspace_id` text,
	`session_id` text,
	`status` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`extracted_count` integer NOT NULL,
	`created_memory_ids_json` text,
	`raw_output_json` text,
	`error_json` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`metadata_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memory_capture_attempts_run` ON `memory_capture_attempts` (`run_id`);--> statement-breakpoint
CREATE TABLE `memory_markdown_mirrors` (
	`mirror_id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`workspace_id` text,
	`target_path` text NOT NULL,
	`status` text NOT NULL,
	`last_exported_at` text,
	`content_hash` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`metadata_json` text,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_records`(`memory_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memory_markdown_mirrors_memory` ON `memory_markdown_mirrors` (`memory_id`);--> statement-breakpoint
CREATE TABLE `memory_recall_traces` (
	`recall_trace_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`model_call_id` text,
	`workspace_id` text,
	`session_id` text,
	`query_text` text NOT NULL,
	`selected_count` integer NOT NULL,
	`request_json` text NOT NULL,
	`results_json` text NOT NULL,
	`created_at` text NOT NULL,
	`metadata_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_call_id`) REFERENCES `model_calls`(`model_call_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memory_recall_traces_run` ON `memory_recall_traces` (`run_id`);--> statement-breakpoint
CREATE TABLE `memory_records` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`session_id` text,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`content` text NOT NULL,
	`normalized_text` text NOT NULL,
	`summary` text,
	`confidence` real,
	`source_json` text,
	`evidence_json` text,
	`dedupe_key` text,
	`superseded_by_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_used_at` text,
	`use_count` integer NOT NULL,
	`metadata_json` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`superseded_by_id`) REFERENCES `memory_records`(`memory_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memory_records_scope_workspace_kind_status` ON `memory_records` (`scope`,`workspace_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `idx_memory_records_last_used_at` ON `memory_records` (`last_used_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_records_dedupe` ON `memory_records` (`scope`,`workspace_id`,`kind`,`dedupe_key`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `model_calls` (
	`model_call_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`call_order` integer NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`status` text NOT NULL,
	`input_summary_json` text,
	`context_snapshot_json` text,
	`request_json` text,
	`response_json` text,
	`output_summary_json` text,
	`token_usage_json` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`error_json` text,
	`metadata_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_calls_run_order` ON `model_calls` (`run_id`,`call_order`);--> statement-breakpoint
CREATE TABLE `session_compactions` (
	`compaction_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`summary_text` text NOT NULL,
	`covered_until_entry_id` text,
	`first_kept_entry_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_compactions_session_created` ON `session_compactions` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `session_entries` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_entry_id` text,
	`entry_type` text,
	`message_id` text,
	`compaction_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_entry_id`) REFERENCES `session_entries`(`entry_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`compaction_id`) REFERENCES `session_compactions`(`compaction_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_session_entries_session_created` ON `session_entries` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_session_entries_parent` ON `session_entries` (`session_id`,`parent_entry_id`);--> statement-breakpoint
CREATE INDEX `idx_session_entries_type` ON `session_entries` (`session_id`,`entry_type`);--> statement-breakpoint
CREATE INDEX `idx_session_entries_message` ON `session_entries` (`session_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `idx_session_entries_compaction` ON `session_entries` (`session_id`,`compaction_id`);--> statement-breakpoint
CREATE TABLE `session_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text,
	`role` text NOT NULL,
	`content_text` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_messages_session_created` ON `session_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_session_messages_run` ON `session_messages` (`run_id`);--> statement-breakpoint
CREATE TABLE `session_message_attachments` (
	`attachment_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`mime_type` text,
	`source_type` text NOT NULL,
	`source_value` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `session_messages`(`message_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_message_attachments_message` ON `session_message_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_session_message_attachments_session` ON `session_message_attachments` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`active_entry_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`metadata_json` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_entry_id`) REFERENCES `session_entries`(`entry_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_workspace_updated` ON `sessions` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_active_entry` ON `sessions` (`active_entry_id`);--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`tool_call_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`model_call_id` text NOT NULL,
	`call_order` integer NOT NULL,
	`provider_tool_call_id` text,
	`tool_source_id` text,
	`tool_name` text NOT NULL,
	`model_visible_name` text NOT NULL,
	`input_json` text NOT NULL,
	`input_preview` text,
	`status` text NOT NULL,
	`permission_decision_json` text,
	`approval_request_id` text,
	`result_json` text,
	`result_preview` text,
	`observation_json` text,
	`submitted_to_model_at` text,
	`started_at` text,
	`completed_at` text,
	`error_json` text,
	`metadata_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_call_id`) REFERENCES `model_calls`(`model_call_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_source_id`) REFERENCES `tool_sources`(`tool_source_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tool_calls_run_order` ON `tool_calls` (`run_id`,`call_order`);--> statement-breakpoint
CREATE INDEX `idx_tool_calls_model_order` ON `tool_calls` (`model_call_id`,`call_order`);--> statement-breakpoint
CREATE INDEX `idx_tool_calls_status` ON `tool_calls` (`status`);--> statement-breakpoint
CREATE TABLE `tool_registry_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`workspace_id` text,
	`tool_count` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`metadata_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tool_registry_snapshots_run` ON `tool_registry_snapshots` (`run_id`);--> statement-breakpoint
CREATE TABLE `tool_sources` (
	`tool_source_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`source_type` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`enabled` integer NOT NULL,
	`config_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`metadata_json` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tool_sources_workspace_type_name` ON `tool_sources` (`workspace_id`,`source_type`,`name`);--> statement-breakpoint
CREATE TABLE `workspace_changed_files` (
	`changed_file_id` text PRIMARY KEY NOT NULL,
	`change_set_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`change_kind` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`change_set_id`) REFERENCES `workspace_changes`(`change_set_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_changed_files_change` ON `workspace_changed_files` (`change_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_changed_files_change_path` ON `workspace_changed_files` (`change_set_id`,`workspace_path`);--> statement-breakpoint
CREATE TABLE `workspace_changes` (
	`change_set_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`changed_file_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`finalized_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`workspace_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_loop_runs`(`run_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_changes_run` ON `workspace_changes` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_changes_workspace_created` ON `workspace_changes` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`root_path_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_opened_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_root_path_key_unique` ON `workspaces` (`root_path_key`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_last_opened_at` ON `workspaces` (`last_opened_at`);
