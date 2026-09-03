/* Protects Discovery persistence after execution-only Interest facts moved to Trace. */
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';

describe('Discovery background operation migration', () => {
  let database: DatabaseConnection | undefined;
  afterEach(() => database?.close());

  it('keeps business tables and removes the Interest Understanding execution table', () => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const tables = database.prepare<{ name: string }>({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    }).all().map((entry) => entry.name);
    expect(tables).not.toContain('discovery_interest_understandings');
    expect(tables).not.toContain('discovery_candidate_supply_checks');
    expect(tables).toContain('discovery_candidates');
    expect(tables).toContain('discovery_candidate_interest_matches');
    const columns = database.prepare<{ name: string }>({
      sql: 'PRAGMA table_info(discovery_preference_learning_batches)',
    }).all().map((entry) => entry.name);
    expect(columns).toContain('result_revisions_json');
    const participationColumns = database.prepare<{ name: string; pk: number }>({
      sql: 'PRAGMA table_info(discovery_session_policies)',
    }).all();
    expect(participationColumns).toContainEqual(expect.objectContaining({
      name: 'session_participation_id',
      pk: 1,
    }));
  });
});

