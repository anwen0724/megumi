// @vitest-environment node
/* Protects the durable memory state and reference-retention contract. */
import { describe, it, expect } from 'vitest';
import { createDatabase, migrateDatabase } from '@megumi/application/storage/index';

describe('Memory foundation migration', () => {
  it('creates empty memory state and retains referenced extraction versions', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      migrateDatabase({ database });
      const tables = database.prepare<{ name: string }>({ sql: "SELECT name FROM sqlite_master WHERE type = 'table'" }).all().map(row => row.name);
      expect(tables).toContain('memory_state');
      expect(database.prepare({ sql: 'SELECT artifact_state, dirty_revision, clear_pending FROM memory_state WHERE id = 1' }).get())
        .toEqual({ artifact_state: 'empty', dirty_revision: 0, clear_pending: 0 });
      database.prepare({ sql: "INSERT INTO memory_sources(session_id, updated_at) VALUES ('s1', '2026-10-08T00:00:00.000Z')" }).run();
      database.prepare({ sql: `INSERT INTO memory_extractions(session_id, source_version, source_updated_at, raw_memory, rollout_summary, rollout_slug, coverage_json, extracted_at)
        VALUES ('s1', 'v1', '2026-10-08T00:00:00.000Z', 'fact', 'summary', '', '{}', '2026-10-08T00:00:00.000Z')` }).run();
      database.prepare({ sql: "INSERT INTO memory_current_extractions(session_id, source_version) VALUES ('s1', 'v1')" }).run();
      expect(() => database.prepare({ sql: "DELETE FROM memory_extractions WHERE session_id = 's1'" }).run()).toThrow();
      expect(() => database.prepare({ sql: "INSERT INTO memory_current_extractions(session_id, source_version) VALUES ('s1', 'v1')" }).run()).toThrow();
      database.prepare({ sql: "INSERT INTO memory_snapshots VALUES ('snapshot1', 1, '{}', '2026-10-08')" }).run();
      database.prepare({ sql: "INSERT INTO memory_snapshot_sources VALUES ('snapshot1', 's1', 'v1', 0, 'rollouts/source.md')" }).run();
      database.prepare({ sql: 'DELETE FROM memory_current_extractions' }).run();
      expect(() => database.prepare({ sql: 'DELETE FROM memory_extractions' }).run()).toThrow();
      database.prepare({ sql: 'DELETE FROM memory_snapshots' }).run();
      expect(() => database.prepare({ sql: 'DELETE FROM memory_extractions' }).run()).not.toThrow();
      expect(migrateDatabase({ database }).appliedMigrations).toBe(0);
    } finally { database.close(); }
  });
});
