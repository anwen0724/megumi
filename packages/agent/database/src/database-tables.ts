/* Declares physical Database tables and their single business owners. */
export const databaseTables = [
  'workspaces',
  'sessions',
  'session_entries',
  'session_messages',
  'session_message_attachments',
  'session_compactions',
  'workspace_changes',
  'workspace_changed_files',
  'skill_availability',
  'discovery_interests',
  'discovery_interest_evidence',
  'discovery_session_policies',
  'discovery_batches',
  'discovery_recommendations',
] as const;

export type DatabaseTable = (typeof databaseTables)[number];

export interface DatabaseTableOwner {
  readonly repository: string;
  readonly module: string;
  readonly modulePath: string;
  readonly tables: readonly DatabaseTable[];
}

export const databaseTableOwnership = {
  workspace: {
    module: 'workspace',
    repository: 'WorkspaceStore',
    modulePath: 'packages/agent/workspace',
    tables: ['workspaces'],
  },
  session: {
    module: 'session',
    repository: 'SessionStore',
    modulePath: 'packages/agent/session',
    tables: [
      'sessions',
      'session_entries',
      'session_messages',
      'session_message_attachments',
      'session_compactions',
    ],
  },
  workspaceChange: {
    module: 'workspace',
    repository: 'WorkspaceStore',
    modulePath: 'packages/agent/workspace',
    tables: ['workspace_changes', 'workspace_changed_files'],
  },
  skill: {
    module: 'skills',
    repository: 'SkillRepository',
    modulePath: 'packages/agent/skills',
    tables: ['skill_availability'],
  },
  discovery: {
    module: 'discovery-agent',
    repository: 'DiscoveryRepository',
    modulePath: 'packages/agent/discovery',
    tables: [
      'discovery_interests',
      'discovery_interest_evidence',
      'discovery_session_policies',
      'discovery_batches',
      'discovery_recommendations',
    ],
  },
} as const satisfies Record<string, DatabaseTableOwner>;

export type DatabaseTableOwnership = typeof databaseTableOwnership;
