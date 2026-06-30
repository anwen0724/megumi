// Verifies the Coding Agent database schema target table set.
import { describe, expect, it } from 'vitest';
import { targetDatabaseTables } from '@megumi/coding-agent/persistence/schema';

const expectedProductTables = [
  'workspaces',
  'sessions',
  'session_entries',
  'session_leaf_changes',
  'session_messages',
  'session_compactions',
  'agent_loop_runs',
  'model_calls',
  'tool_sources',
  'tool_calls',
  'approval_requests',
  'workspace_changes',
  'workspace_changed_files',
  'workspace_file_snapshots',
  'workspace_restore_operations',
  'workspace_restore_file_results',
  'memory_records',
  'memory_markdown_mirrors',
  'artifacts',
  'artifact_versions',
  'artifact_source_refs',
  'agent_loop_events',
  'tool_registry_snapshots',
  'memory_recall_traces',
  'memory_capture_attempts',
] as const;

describe('Drizzle schema target table list', () => {
  it('defines the confirmed product table set', () => {
    expect(targetDatabaseTables).toEqual(expectedProductTables);
  });
});
