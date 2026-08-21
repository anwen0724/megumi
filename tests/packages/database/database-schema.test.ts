/* Verifies the final database contains only durable product facts. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  databaseTables,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/database/src';

describe('final Database schema', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  });

  afterEach(() => database.close());

  it('contains exactly the remaining durable business tables', () => {
    const tables = database.prepare<{ name: string }>({ sql: `
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%'
      ORDER BY name
    ` }).all().map((row) => row.name);

    expect(tables).toEqual([...databaseTables].sort());
  });

  it('keeps execution_id as correlation data without a Run table foreign key', () => {
    expect(columns(database, 'session_messages')).toEqual([
      'message_id', 'session_id', 'execution_id', 'message_kind', 'message_json', 'created_at', 'completed_at',
    ]);
    expect(columns(database, 'workspace_changes')).toContain('execution_id');

    for (const table of ['session_messages', 'workspace_changes']) {
      expect(foreignKeys(database, table).map((key) => key.table)).not.toContain('agent_runs');
    }
    expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
  });

  it('does not retain removed runtime, Artifact, or Memory tables', () => {
    for (const table of [
      'agent_runs',
      'agent_run_approval_requests',
      'agent_run_runtime_events',
      'skill_usage_record',
      'memory_recall_traces',
      'memory_capture_attempts',
      'memory_records',
      'memory_markdown_mirrors',
      'artifacts',
      'artifact_versions',
      'artifact_source_refs',
    ]) {
      expect(tableExists(database, table)).toBe(false);
    }
  });
});

function columns(database: DatabaseConnection, table: string): string[] {
  return database.prepare<{ name: string }>({ sql: `PRAGMA table_info(${table})` }).all().map((row) => row.name);
}

function foreignKeys(database: DatabaseConnection, table: string): readonly { table: string }[] {
  return database.prepare<{ table: string }>({ sql: `PRAGMA foreign_key_list(${table})` }).all();
}

function tableExists(database: DatabaseConnection, table: string): boolean {
  return Boolean(database.prepare({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  }).get([table]));
}
