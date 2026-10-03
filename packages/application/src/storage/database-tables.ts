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
  'discovery_interest_session_settings',
  'discovery_recommendations',
  'discovery_recommendation_contents',
  'discovery_recommendation_states',
  'discovery_candidates',
  'discovery_candidate_interest_matches',
  'discovery_preference_sets',
  'discovery_preferences',
  'discovery_preference_evidence',
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
    modulePath: 'packages/application/src/skill-operations.ts',
    tables: ['skill_availability'],
  },
  discovery: {
    module: 'discovery-agent',
    repository: 'DiscoveryRepository',
    modulePath: 'packages/application/src/recommendation',
    tables: [
      'discovery_interests',
      'discovery_interest_evidence',
      'discovery_interest_session_settings',
      'discovery_recommendations',
      'discovery_recommendation_contents',
      'discovery_recommendation_states',
      'discovery_candidates',
      'discovery_candidate_interest_matches',
      'discovery_preference_sets',
      'discovery_preferences',
      'discovery_preference_evidence',
    ],
  },
} as const satisfies Record<string, DatabaseTableOwner>;

export type DatabaseTableOwnership = typeof databaseTableOwnership;
