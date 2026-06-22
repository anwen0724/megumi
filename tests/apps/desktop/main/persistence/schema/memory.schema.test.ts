import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/desktop/main/persistence/connection';
import { migrateDatabase } from '@megumi/desktop/main/persistence/schema/migrations';

let database: MegumiDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('memory schema migrations', () => {
  it('keeps memory_records authoritative and adds 18.02 runtime columns', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);

    expect(tableNames()).toEqual(expect.arrayContaining([
      'memory_candidates',
      'memory_records',
      'memory_source_refs',
      'memory_recall_requests',
      'memory_recall_results',
      'memory_access_logs',
      'memory_audit_logs',
    ]));

    expect(columnNames('memory_records')).toEqual(expect.arrayContaining([
      'memory_id',
      'scope',
      'kind',
      'status',
      'content',
      'summary',
      'normalized_text',
      'dedupe_key',
      'source',
      'source_run_id',
      'source_session_id',
      'source_message_id',
      'source_tool_call_id',
      'evidence_json',
      'superseded_by_id',
      'last_used_at',
      'use_count',
      'memory_json',
    ]));
  });

  it('creates markdown mirror state table without making markdown authoritative', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);

    expect(tableNames()).toContain('memory_markdown_mirrors');
    expect(columnNames('memory_markdown_mirrors')).toEqual(expect.arrayContaining([
      'mirror_id',
      'scope',
      'project_id',
      'file_path',
      'status',
      'last_imported_at',
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
    migrateDatabase(database);

    expect(indexNames()).toEqual(expect.arrayContaining([
      'idx_memory_records_active_lookup',
      'idx_memory_records_dedupe_key',
      'idx_memory_records_updated_at',
      'idx_memory_records_last_used_at',
      'idx_memory_recall_results_memory',
      'idx_memory_recall_requests_run_session',
      'idx_memory_markdown_mirrors_scope_project',
      'idx_memory_markdown_mirrors_status',
    ]));
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
