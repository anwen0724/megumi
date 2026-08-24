/* Verifies Skill persists availability only. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '../../../packages/agent/database/src';

describe('Skill database schema', () => {
  it('owns only skill_availability', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      migrateDatabase({ database });
      expect(database.prepare({ sql: 'PRAGMA table_info(skill_availability)' }).all()).not.toHaveLength(0);
      expect(database.prepare({
        sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'skill_usage_record'",
      }).get())
        .toBeUndefined();
    } finally {
      database.close();
    }
  });
});
