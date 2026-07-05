// Defines the canonical table inventory for the Drizzle-managed Coding Agent database.
export const targetDatabaseTables = [
  'workspaces',
  'sessions',
  'session_entries',
  'session_messages',
  'session_message_attachments',
  'session_compactions',
  'agent_loop_runs',
  'agent_runs',
  'agent_run_approval_requests',
  'model_calls',
  'tool_sources',
  'tool_calls',
  'approval_requests',
  'workspace_changes',
  'workspace_changed_files',
  'memory_records',
  'memory_markdown_mirrors',
  'artifacts',
  'artifact_versions',
  'artifact_source_refs',
  'agent_loop_events',
  'tool_registry_snapshots',
  'memory_recall_traces',
  'memory_capture_attempts',
] as const;

export type TargetDatabaseTable = (typeof targetDatabaseTables)[number];
