// Verifies the Coding Agent database schema target table set.
import { describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { targetDatabaseTables } from '@megumi/coding-agent/persistence/schema';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';

const expectedProductTables = [
  'workspaces',
  'sessions',
  'session_entries',
  'session_messages',
  'session_message_attachments',
  'session_compactions',
  'agent_runs',
  'agent_run_approval_requests',
  'agent_run_runtime_events',
  'workspace_changes',
  'workspace_changed_files',
  'skill_availability',
  'skill_usage_record',
  'memory_records',
  'memory_markdown_mirrors',
  'artifacts',
  'artifact_versions',
  'artifact_source_refs',
  'memory_recall_traces',
  'memory_capture_attempts',
] as const;

describe('Drizzle schema target table list', () => {
  it('defines the confirmed product table set', () => {
    expect(targetDatabaseTables).toEqual(expectedProductTables);
  });

  it('keeps cross-table references explicit in the migrated SQLite schema', () => {
    const database = createDatabase(':memory:');
    try {
      applyCodingAgentDatabaseMigrations(database);

      expect(tables(database)).toContain('session_message_attachments');
      expect(tables(database)).not.toEqual(expect.arrayContaining([
        'session_leaf_changes',
        'agent_loop_runs',
        'agent_loop_events',
        'model_calls',
        'tool_registry_snapshots',
        'tool_sources',
        'tool_calls',
        'approval_requests',
        'workspace_file_snapshots',
        'workspace_restore_operations',
        'workspace_restore_file_results',
      ]));
      expect(columns(database, 'session_messages')).toEqual(expect.arrayContaining([
        'message_id',
        'session_id',
        'run_id',
        'role',
        'content_text',
        'created_at',
        'completed_at',
      ]));
      expect(columns(database, 'session_messages')).not.toEqual(expect.arrayContaining([
        'status',
        'blocks_json',
        'metadata_json',
      ]));
      expect(columns(database, 'session_entries')).toContain('entry_type');
      expect(columns(database, 'session_entries')).not.toEqual(expect.arrayContaining([
        'entry_kind',
        'target_entry_id',
        'metadata_json',
      ]));
      expect(columns(database, 'session_compactions')).not.toEqual(expect.arrayContaining([
        'status',
        'token_count_before',
        'token_count_after',
        'completed_at',
        'error_json',
        'metadata_json',
      ]));
      expect(columns(database, 'workspaces')).toEqual(expect.arrayContaining([
        'workspace_id',
        'name',
        'root_path',
        'root_path_key',
        'status',
        'created_at',
        'updated_at',
        'last_opened_at',
      ]));
      expect(columns(database, 'workspaces')).not.toContain('metadata_json');
      expect(columns(database, 'sessions')).not.toContain('metadata_json');
      expect(columns(database, 'workspace_changes')).toEqual(expect.arrayContaining([
        'change_set_id',
        'workspace_id',
        'session_id',
        'run_id',
        'status',
        'changed_file_count',
        'created_at',
        'finalized_at',
      ]));
      expect(columns(database, 'workspace_changes')).not.toEqual(expect.arrayContaining([
        'change_id',
        'metadata_json',
      ]));
      expect(columns(database, 'workspace_changed_files')).toEqual(expect.arrayContaining([
        'changed_file_id',
        'change_set_id',
        'workspace_path',
        'change_kind',
        'created_at',
      ]));
      expect(columns(database, 'workspace_changed_files')).not.toEqual(expect.arrayContaining([
        'change_id',
        'path',
        'restore_state',
        'before_exists',
        'before_snapshot_id',
        'before_hash',
        'after_exists',
        'after_snapshot_id',
        'after_hash',
        'updated_at',
        'metadata_json',
      ]));
      expect(columns(database, 'session_message_attachments')).toEqual(expect.arrayContaining([
        'attachment_id',
        'message_id',
        'session_id',
        'type',
        'name',
        'mime_type',
        'source_type',
        'source_value',
        'created_at',
      ]));
      expect(foreignKeys(database, 'sessions')).toContainEqual({
        from: 'workspace_id',
        table: 'workspaces',
        to: 'workspace_id',
        onDelete: 'NO ACTION',
      });
      expect(foreignKeys(database, 'sessions')).toContainEqual({
        from: 'active_entry_id',
        table: 'session_entries',
        to: 'entry_id',
        onDelete: 'SET NULL',
      });
      expect(columns(database, 'agent_runs')).toEqual([
        'run_id',
        'workspace_id',
        'session_id',
        'provider_id',
        'model_id',
        'trigger_type',
        'trigger_user_message_id',
        'trigger_command_name',
        'status',
        'created_at',
        'started_at',
        'completed_at',
        'failure_json',
      ]);
      expect(columns(database, 'agent_run_approval_requests')).toEqual([
        'approval_request_id',
        'run_id',
        'subject_json',
        'status',
        'created_at',
        'decided_at',
        'decision_json',
      ]);
      expect(columns(database, 'agent_run_runtime_events')).toEqual([
        'event_id',
        'run_id',
        'session_id',
        'event_type',
        'sequence',
        'created_at',
        'source',
        'visibility',
        'persist',
        'payload_json',
      ]);
      expect(foreignKeys(database, 'agent_runs')).toContainEqual({
        from: 'workspace_id',
        table: 'workspaces',
        to: 'workspace_id',
        onDelete: 'NO ACTION',
      });
      expect(foreignKeys(database, 'agent_run_approval_requests')).toContainEqual({
        from: 'run_id',
        table: 'agent_runs',
        to: 'run_id',
        onDelete: 'CASCADE',
      });
      expect(foreignKeys(database, 'agent_run_runtime_events')).toEqual(expect.arrayContaining([
        {
          from: 'run_id',
          table: 'agent_runs',
          to: 'run_id',
          onDelete: 'CASCADE',
        },
        {
          from: 'session_id',
          table: 'sessions',
          to: 'session_id',
          onDelete: 'CASCADE',
        },
      ]));
      expect(foreignKeys(database, 'workspace_changes')).toContainEqual({
        from: 'workspace_id',
        table: 'workspaces',
        to: 'workspace_id',
        onDelete: 'NO ACTION',
      });
      expect(columns(database, 'skill_availability')).toEqual([
        'skill_availability_id',
        'skill_id',
        'workspace_id',
        'available',
        'created_at',
        'updated_at',
      ]);
      expect(columns(database, 'skill_usage_record')).toEqual([
        'skill_usage_record_id',
        'skill_id',
        'workspace_id',
        'session_id',
        'run_id',
        'trigger_kind',
        'created_at',
      ]);
      expect(foreignKeys(database, 'skill_usage_record')).toEqual(expect.arrayContaining([
        {
          from: 'session_id',
          table: 'sessions',
          to: 'session_id',
          onDelete: 'CASCADE',
        },
        {
          from: 'run_id',
          table: 'agent_runs',
          to: 'run_id',
          onDelete: 'SET NULL',
        },
      ]));
      expect(foreignKeys(database, 'session_entries')).toEqual(expect.arrayContaining([
        {
          from: 'parent_entry_id',
          table: 'session_entries',
          to: 'entry_id',
          onDelete: 'SET NULL',
        },
        {
          from: 'compaction_id',
          table: 'session_compactions',
          to: 'compaction_id',
          onDelete: 'SET NULL',
        },
      ]));
      expect(foreignKeys(database, 'session_message_attachments')).toEqual(expect.arrayContaining([
        {
          from: 'message_id',
          table: 'session_messages',
          to: 'message_id',
          onDelete: 'CASCADE',
        },
        {
          from: 'session_id',
          table: 'sessions',
          to: 'session_id',
          onDelete: 'CASCADE',
        },
      ]));
      expect(foreignKeys(database, 'memory_records')).toContainEqual({
        from: 'superseded_by_id',
        table: 'memory_records',
        to: 'memory_id',
        onDelete: 'SET NULL',
      });
      expect(foreignKeys(database, 'memory_recall_traces')).toContainEqual({
        from: 'run_id',
        table: 'agent_runs',
        to: 'run_id',
        onDelete: 'CASCADE',
      });
      expect(foreignKeys(database, 'memory_capture_attempts')).toContainEqual({
        from: 'run_id',
        table: 'agent_runs',
        to: 'run_id',
        onDelete: 'SET NULL',
      });
      expect(foreignKeys(database, 'artifacts')).toContainEqual({
        from: 'current_version_id',
        table: 'artifact_versions',
        to: 'artifact_version_id',
        onDelete: 'SET NULL',
      });
      expect(foreignKeys(database, 'artifacts')).toContainEqual({
        from: 'run_id',
        table: 'agent_runs',
        to: 'run_id',
        onDelete: 'SET NULL',
      });
      expect(foreignKeys(database, 'artifact_versions')).toContainEqual({
        from: 'created_by_run_id',
        table: 'agent_runs',
        to: 'run_id',
        onDelete: 'SET NULL',
      });
    } finally {
      database.close();
    }
  });
});

function tables(database: MegumiDatabase): string[] {
  return (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
    name: string;
  }>).map((row) => row.name);
}

function columns(database: MegumiDatabase, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>).map((row) => row.name);
}

function foreignKeys(database: MegumiDatabase, tableName: string): Array<{
  from: string;
  table: string;
  to: string;
  onDelete: string;
}> {
  return (database.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{
    from: string;
    table: string;
    to: string;
    on_delete: string;
  }>).map((row) => ({
    from: row.from,
    table: row.table,
    to: row.to,
    onDelete: row.on_delete,
  }));
}
