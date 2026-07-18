/* Verifies Memory persists durable records and Markdown mirrors only. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/agent/persistence/connection';
import { applyAgentDatabaseMigrations } from '@megumi/agent/persistence/schema';

describe('Memory database schema', () => {
  it('contains durable memory tables without runtime diagnostic tables', () => {
    const database = createDatabase(':memory:');
    try {
      applyAgentDatabaseMigrations(database);
      const tables = (database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'memory_%' ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      expect(tables).toEqual(['memory_markdown_mirrors', 'memory_records']);
    } finally {
      database.close();
    }
  });
});
