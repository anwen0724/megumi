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
    modulePath: 'packages/coding-agent/workspace',
    tables: [
      'workspaces',
    ],
  },
  session: {
    module: 'session',
    repository: 'SessionRepository',
    modulePath: 'packages/coding-agent/session',
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
    modulePath: 'packages/coding-agent/workspace',
    tables: [
      'workspace_changes',
      'workspace_changed_files',
    ],
  },
  skill: {
    module: 'skills',
    repository: 'SkillRepository',
    modulePath: 'packages/coding-agent/skills',
    tables: [
      'skill_availability',
    ],
  },
  memory: {
    module: 'memory',
    repository: 'MemoryRepository',
    tables: [
      'memory_records',
      'memory_markdown_mirrors',
    ],
  },
  artifact: {
    module: 'artifacts',
    repository: 'ArtifactRepository',
    tables: [
      'artifacts',
      'artifact_versions',
      'artifact_source_refs',
    ],
  },
} as const satisfies Record<string, PersistenceTableOwner>;

export type PersistenceTableOwnership = typeof persistenceTableOwnership;
