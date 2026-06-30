import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';

let database: MegumiDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('memory schema migrations', () => {
  it('keeps memory_records authoritative in the redesigned schema', () => {
    database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);

    expect(tableNames()).toEqual(expect.arrayContaining([
      'memory_records',
      'memory_markdown_mirrors',
      'memory_recall_traces',
      'memory_capture_attempts',
    ]));

    expect(columnNames('memory_records')).toEqual(expect.arrayContaining([
      'memory_id',
      'workspace_id',
      'session_id',
      'scope',
      'kind',
      'status',
      'content',
      'normalized_text',
      'summary',
      'confidence',
      'source_json',
      'evidence_json',
      'dedupe_key',
      'superseded_by_id',
      'created_at',
      'updated_at',
      'last_used_at',
      'use_count',
      'metadata_json',
    ]));
  });

  it('creates markdown mirror state table without making markdown authoritative', () => {
    database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);

    expect(tableNames()).toContain('memory_markdown_mirrors');
    expect(columnNames('memory_markdown_mirrors')).toEqual(expect.arrayContaining([
      'mirror_id',
      'memory_id',
      'workspace_id',
      'target_path',
      'status',
      'last_exported_at',
      'content_hash',
      'last_error',
      'metadata_json',
      'created_at',
      'updated_at',
    ]));
  });

  it('creates lookup, dedupe, recall relation, and mirror indexes', () => {
    database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);

    expect(indexNames()).toEqual(expect.arrayContaining([
      'idx_memory_records_scope_workspace_kind_status',
      'idx_memory_records_dedupe',
      'idx_memory_records_last_used_at',
      'idx_memory_recall_traces_run',
      'idx_memory_capture_attempts_run',
      'idx_memory_markdown_mirrors_memory',
    ]));
    expect(indexSql('idx_memory_records_dedupe')).toContain("WHERE status = 'active'");
  });
});

function tableNames(): string[] {
  return (database
    ?.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>).map((row) => row.name);
}

function columnNames(tableName: string): string[] {
  return (database
    ?.prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>).map((row) => row.name);
}

function indexNames(): string[] {
  return (database
    ?.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .all() as Array<{ name: string }>).map((row) => row.name);
}

function indexSql(indexName: string): string {
  const row = database
    ?.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { sql: string | null } | undefined;
  return row?.sql ?? '';
}
