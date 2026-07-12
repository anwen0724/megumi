/* Verifies Skill persists availability only. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema';

describe('Skill database schema', () => {
  it('owns only skill_availability', () => {
    const database = createDatabase(':memory:');
    try {
      applyCodingAgentDatabaseMigrations(database);
      expect(database.prepare(`PRAGMA table_info(skill_availability)`).all()).not.toHaveLength(0);
      expect(database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'skill_usage_record'`).get())
        .toBeUndefined();
    } finally {
      database.close();
    }
  });
});
