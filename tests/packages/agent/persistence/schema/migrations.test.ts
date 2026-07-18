// Verifies the Drizzle-managed database migration creates only the redesigned schema.
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyAgentDatabaseMigrations,
  migrateAgentDatabase,
} from '@megumi/agent/persistence/schema/migrate';
import { targetDatabaseTables } from '@megumi/agent/persistence/schema/table-list';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('applyAgentDatabaseMigrations', () => {
  it('creates the redesigned Agent tables', () => {
    const database = new Database(':memory:');
    applyAgentDatabaseMigrations(database);

    const tables = tableNames(database);
    for (const table of targetDatabaseTables) {
      expect(tables).toContain(table);
    }

    database.close();
  });

  it('creates only the redesigned product tables and Drizzle infrastructure table', () => {
    const database = new Database(':memory:');
    applyAgentDatabaseMigrations(database);

    const appTables = tableNames(database).filter((table) => !table.startsWith('__drizzle_'));
    expect(appTables.sort()).toEqual([...targetDatabaseTables].sort());

    database.close();
  });

  it('is idempotent on an already migrated database', () => {
    const database = new Database(':memory:');
    applyAgentDatabaseMigrations(database);
    applyAgentDatabaseMigrations(database);

    expect(tableNames(database)).toEqual(expect.arrayContaining([...targetDatabaseTables]));
    database.close();
  });

  it('creates Drizzle migration metadata for future version upgrades', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-migrations-'));
    const result = migrateAgentDatabase({ sqliteDirectory: tempDir });

    try {
      expect(tableNames(result.database)).toContain('__drizzle_migrations');
      const migrationRows = result.database
        .prepare('SELECT hash FROM __drizzle_migrations')
        .all() as Array<{ hash: string }>;
      expect(migrationRows.length).toBeGreaterThan(0);
    } finally {
      result.database.close();
    }
  });
});

function tableNames(database: Database.Database): string[] {
  return (database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name ASC
  `).all() as Array<{ name: string }>).map((row) => row.name);
}
