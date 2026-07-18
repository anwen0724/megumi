// Defines the canonical table inventory for the Drizzle-managed Agent database.
export const targetDatabaseTables = [
  'workspaces',
  'sessions',
  'session_entries',
  'session_messages',
  'session_message_attachments',
  'session_compactions',
  'workspace_changes',
  'workspace_changed_files',
  'skill_availability',
  'memory_records',
  'memory_markdown_mirrors',
  'artifacts',
  'artifact_versions',
  'artifact_source_refs',
] as const;

export type TargetDatabaseTable = (typeof targetDatabaseTables)[number];
