// Documents which persistence aggregate owns each redesigned product table.
import type { TargetDatabaseTable } from './table-list';

export interface PersistenceTableOwner {
  repository: string;
  module: string;
  modulePath?: string;
  tables: readonly TargetDatabaseTable[];
}

export const persistenceTableOwnership = {
  workspace: {
    module: 'workspace',
    repository: 'WorkspaceRepository',
    modulePath: 'packages/agent/workspace',
    tables: [
      'workspaces',
    ],
  },
  session: {
    module: 'session',
    repository: 'SessionRepository',
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
    repository: 'WorkspaceChangeRepository',
    modulePath: 'packages/agent/workspace',
    tables: [
      'workspace_changes',
      'workspace_changed_files',
    ],
  },
  skill: {
    module: 'skills',
    repository: 'SkillRepository',
    modulePath: 'packages/skills',
    tables: [
      'skill_availability',
    ],
  },
} as const satisfies Record<string, PersistenceTableOwner>;

export type PersistenceTableOwnership = typeof persistenceTableOwnership;
