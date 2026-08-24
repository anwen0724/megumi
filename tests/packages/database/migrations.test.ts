// Verifies the Drizzle-managed database migration creates only the redesigned schema.
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  databaseTables,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/agent/database/src';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('migrateDatabase', () => {
  it('creates the redesigned Database tables', () => {
    const database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });

    const tables = tableNames(database);
    for (const table of databaseTables) {
      expect(tables).toContain(table);
    }

    database.close();
  });

  it('creates only the redesigned product tables and Drizzle infrastructure table', () => {
    const database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });

    const appTables = tableNames(database).filter((table) => !table.startsWith('__drizzle_'));
    expect(appTables.sort()).toEqual([...databaseTables].sort());

    database.close();
  });

  it('is idempotent on an already migrated database', () => {
    const database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const repeated = migrateDatabase({ database });

    expect(repeated.appliedMigrations).toBe(0);
    expect(tableNames(database)).toEqual(expect.arrayContaining([...databaseTables]));
    database.close();
  });

  it('creates Drizzle migration metadata for future version upgrades', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-migrations-'));
    const database = createDatabase({ filename: path.join(tempDir, 'megumi.sqlite3') });

    try {
      const result = migrateDatabase({ database });
      expect(result.currentMigration).toBe('0013_discovery_content_identity_v2');
      expect(tableNames(database)).toContain('__drizzle_migrations');
      const migrationRows = database.prepare<{ hash: string }>({
        sql: 'SELECT hash FROM __drizzle_migrations',
      }).all();
      expect(migrationRows.length).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });
});

function tableNames(database: DatabaseConnection): string[] {
  return database.prepare<{ name: string }>({ sql: `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name ASC
  ` }).all().map((row) => row.name);
}
