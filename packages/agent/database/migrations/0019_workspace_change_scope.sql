CREATE UNIQUE INDEX `idx_workspace_changes_scope`
ON `workspace_changes` (`workspace_id`, `session_id`, `execution_id`);
