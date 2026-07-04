// Verifies the Coding Agent database schema target table set.
import { describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { targetDatabaseTables } from '@megumi/coding-agent/persistence/schema';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';

const expectedProductTables = [
  'workspaces',
  'sessions',
  'session_entries',
  'session_leaf_changes',
  'session_messages',
  'session_message_attachments',
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

  it('keeps cross-table references explicit in the migrated SQLite schema', () => {
    const database = createDatabase(':memory:');
    try {
      applyCodingAgentDatabaseMigrations(database);

      expect(tables(database)).toContain('session_message_attachments');
      expect(columns(database, 'session_messages')).toEqual(expect.arrayContaining([
        'message_id',
        'session_id',
        'run_id',
        'role',
        'content_text',
        'created_at',
        'completed_at',
      ]));
      expect(columns(database, 'session_entries')).toContain('entry_type');
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
        from: 'active_entry_id',
        table: 'session_entries',
        to: 'entry_id',
        onDelete: 'SET NULL',
      });
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
        {
          from: 'target_entry_id',
          table: 'session_entries',
          to: 'entry_id',
          onDelete: 'SET NULL',
        },
      ]));
      expect(foreignKeys(database, 'session_leaf_changes')).toEqual(expect.arrayContaining([
        {
          from: 'previous_entry_id',
          table: 'session_entries',
          to: 'entry_id',
          onDelete: 'SET NULL',
        },
        {
          from: 'next_entry_id',
          table: 'session_entries',
          to: 'entry_id',
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
      expect(foreignKeys(database, 'agent_loop_runs')).toEqual(expect.arrayContaining([
        {
          from: 'user_message_id',
          table: 'session_messages',
          to: 'message_id',
          onDelete: 'SET NULL',
        },
        {
          from: 'assistant_message_id',
          table: 'session_messages',
          to: 'message_id',
          onDelete: 'SET NULL',
        },
        {
          from: 'base_run_id',
          table: 'agent_loop_runs',
          to: 'run_id',
          onDelete: 'SET NULL',
        },
        {
          from: 'base_entry_id',
          table: 'session_entries',
          to: 'entry_id',
          onDelete: 'SET NULL',
        },
      ]));
      expect(foreignKeys(database, 'memory_records')).toContainEqual({
        from: 'superseded_by_id',
        table: 'memory_records',
        to: 'memory_id',
        onDelete: 'SET NULL',
      });
      expect(foreignKeys(database, 'artifacts')).toContainEqual({
        from: 'current_version_id',
        table: 'artifact_versions',
        to: 'artifact_version_id',
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
