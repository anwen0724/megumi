/* Protects the durable background-operation facts introduced for Evaluation and product diagnostics. */
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';

describe('Discovery background operation migration', () => {
  let database: DatabaseConnection | undefined;
  afterEach(() => database?.close());

  it('creates Interest Understanding, Candidate Supply Check, and Preference result-revision storage', () => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const tables = database.prepare<{ name: string }>({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    }).all().map((entry) => entry.name);
    expect(tables).toContain('discovery_interest_understandings');
    expect(tables).toContain('discovery_candidate_supply_checks');
    const columns = database.prepare<{ name: string }>({
      sql: 'PRAGMA table_info(discovery_preference_learning_batches)',
    }).all().map((entry) => entry.name);
    expect(columns).toContain('result_revisions_json');
  });
});

