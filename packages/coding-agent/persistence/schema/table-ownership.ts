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
  agentLoop: {
    module: 'agent-loop',
    repository: 'AgentLoopRepository',
    tables: [
      'agent_loop_runs',
      'model_calls',
      'agent_loop_events',
      'tool_registry_snapshots',
    ],
  },
  toolCall: {
    module: 'tools',
    repository: 'ToolCallRepository',
    tables: [
      'tool_sources',
      'tool_calls',
      'approval_requests',
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
  memory: {
    module: 'memory',
    repository: 'MemoryRepository',
    tables: [
      'memory_records',
      'memory_markdown_mirrors',
      'memory_recall_traces',
      'memory_capture_attempts',
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
