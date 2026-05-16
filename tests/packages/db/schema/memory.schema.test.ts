import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/db/connection';
import { migrateDatabase } from '@megumi/db/schema/migrations';

let database: MegumiDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('memory schema migrations', () => {
  it('creates durable memory tables and indexes', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      'memory_candidates',
      'memory_records',
      'memory_source_refs',
      'memory_recall_requests',
      'memory_recall_results',
      'memory_access_logs',
      'memory_audit_logs',
      'memory_settings',
    ]));

    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_memory_candidates_workspace_status',
      'idx_memory_records_scope_status',
      'idx_memory_source_refs_owner',
      'idx_memory_access_logs_memory_id',
    ]));
  });
});
