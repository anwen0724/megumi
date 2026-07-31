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
] as const;

export type TargetDatabaseTable = (typeof targetDatabaseTables)[number];
