/* Declares physical Database tables and their single business owners. */
export const databaseTables = [
  'memory_sources',
  'memory_extractions',
  'memory_current_extractions',
  'memory_runs',
  'memory_jobs',
  'memory_snapshots',
  'memory_snapshot_sources',
  'memory_state',
  'memory_requests',
  'memory_usage_receipts',
  'workspaces',
  'sessions',
  'session_entries',
  'session_messages',
  'session_reply_sequence',
  'session_message_attachments',
  'session_compactions',
  'workspace_changes',
  'workspace_changed_files',
  'skill_availability',
  'interests',
  'contents',
  'content_materials',
  'material_acquisitions',
  'discovery_runs',
  'material_requests',
  'content_analysis',
  'recommendation_candidates',
  'candidate_selection_inputs',
  'search_queries',
  'search_history',
  'search_results',
  'search_result_links',
  'daily_feed_batches',
  'daily_feed_items',
  'curated_selections',
  'curated_selection_items',
  'favorites',
  'recommendation_runs',
  'recommendation_run_judgments',
  'recommendation_state',
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
  memory: {
    module: 'memory',
    repository: 'MemoryStore',
    modulePath: 'packages/application/src/memory',
    tables: ['memory_sources', 'memory_extractions', 'memory_current_extractions',
      'memory_runs', 'memory_jobs', 'memory_snapshots', 'memory_snapshot_sources',
      'memory_state', 'memory_requests', 'memory_usage_receipts'],
  },
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
      'session_reply_sequence',
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
  interests: {module:'recommendation',repository:'InterestStorage',modulePath:'packages/application/src/recommendation/interests',tables:['interests']},
  content: {module:'recommendation',repository:'MaterialStorage',modulePath:'packages/application/src/recommendation/content',tables:['contents','content_materials','material_acquisitions','content_analysis']},
  candidates: {module:'recommendation',repository:'CandidateQualificationStorage',modulePath:'packages/application/src/recommendation/candidates',tables:['recommendation_candidates','candidate_selection_inputs']},
  discovery: {module:'recommendation',repository:'DiscoveryStorage',modulePath:'packages/application/src/recommendation/discovery',tables:['search_queries','search_history','search_results','search_result_links','discovery_runs','material_requests','candidate_supply_state']},
  recommendation: {module:'recommendation',repository:'RecommendationStorage',modulePath:'packages/application/src/recommendation',tables:['daily_feed_batches','daily_feed_items','curated_selections','curated_selection_items','favorites','recommendation_runs','recommendation_run_judgments','recommendation_state']},
} as const satisfies Record<string, DatabaseTableOwner>;
export type DatabaseTableOwnership = typeof databaseTableOwnership;
