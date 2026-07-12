/* Verifies the final database contains only durable product facts. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import {
  applyCodingAgentDatabaseMigrations,
  targetDatabaseTables,
} from '@megumi/coding-agent/persistence/schema';

describe('final Coding Agent database schema', () => {
  let database: MegumiDatabase;

  beforeEach(() => {
    database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);
  });

  afterEach(() => database.close());

  it('contains exactly the 14 durable business tables', () => {
    const tables = (database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%'
      ORDER BY name
    `).all() as Array<{ name: string }>).map((row) => row.name);

    expect(tables).toEqual([...targetDatabaseTables].sort());
  });

  it('keeps run_id as correlation data without a Run table foreign key', () => {
    expect(columns(database, 'session_messages')).toEqual([
      'message_id', 'session_id', 'run_id', 'role', 'message_json', 'created_at', 'completed_at',
    ]);
    expect(columns(database, 'workspace_changes')).toContain('run_id');
    expect(columns(database, 'artifacts')).toContain('run_id');
    expect(columns(database, 'artifact_versions')).toContain('created_by_run_id');

    for (const table of ['session_messages', 'workspace_changes', 'artifacts', 'artifact_versions']) {
      expect(foreignKeys(database, table).map((key) => key.table)).not.toContain('agent_runs');
    }
    expect(foreignKeys(database, 'artifacts')).toContainEqual(expect.objectContaining({
      table: 'artifact_versions',
    }));
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('does not retain runtime, approval, usage, or diagnostic tables', () => {
    for (const table of [
      'agent_runs',
      'agent_run_approval_requests',
      'agent_run_runtime_events',
      'skill_usage_record',
      'memory_recall_traces',
      'memory_capture_attempts',
    ]) {
      expect(tableExists(database, table)).toBe(false);
    }
  });
});

function columns(database: MegumiDatabase, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function foreignKeys(database: MegumiDatabase, table: string): Array<{ table: string }> {
  return database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ table: string }>;
}

function tableExists(database: MegumiDatabase, table: string): boolean {
  return Boolean(database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}
