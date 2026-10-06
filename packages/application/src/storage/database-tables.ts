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
  'interests',
  'contents',
  'content_analysis',
  'content_interest_matches',
  'recommendation_candidates',
  'search_queries',
  'search_results',
  'search_history',
  'candidate_supply_state',
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
    modulePath: 'packages/application/src/workspace',
    tables: ['workspaces'],
  },
  session: {
    module: 'session',
    repository: 'SessionStore',
    modulePath: 'packages/application/src/coding/sessions',
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
    modulePath: 'packages/application/src/workspace',
    tables: ['workspace_changes', 'workspace_changed_files'],
  },
  skill: {
    module: 'skills',
    repository: 'SkillRepository',
    modulePath: 'packages/application/src/skills/manage-skills.ts',
    tables: ['skill_availability'],
  },
  candidateSupply: {
    module: 'recommendation',
    repository: 'CandidateSupplyStorage',
    modulePath: 'packages/application/src/recommendation',
    tables: [
      'interests',
      'contents',
      'content_analysis',
      'content_interest_matches',
      'recommendation_candidates',
      'search_queries',
      'search_results',
      'search_history',
      'candidate_supply_state',
    ],
  },
} as const satisfies Record<string, DatabaseTableOwner>;

export type DatabaseTableOwnership = typeof databaseTableOwnership;
