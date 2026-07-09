// Defines the canonical table inventory for the Drizzle-managed Coding Agent database.
export const targetDatabaseTables = [
  'workspaces',
  'sessions',
  'session_entries',
  'session_messages',
  'session_message_attachments',
  'session_compactions',
  'agent_runs',
  'agent_run_approval_requests',
  'agent_run_runtime_events',
  'workspace_changes',
  'workspace_changed_files',
  'skill_availability',
  'skill_usage_record',
  'memory_records',
  'memory_markdown_mirrors',
  'artifacts',
  'artifact_versions',
  'artifact_source_refs',
  'memory_recall_traces',
  'memory_capture_attempts',
] as const;

export type TargetDatabaseTable = (typeof targetDatabaseTables)[number];
