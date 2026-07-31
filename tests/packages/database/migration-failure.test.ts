// Verifies migration failures stop runtime startup with a clear database error.
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DatabaseMigrationError,
  createDatabase,
  migrateDatabase,
} from '../../../packages/database/src';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('migration failure boundary', () => {
  it('throws a typed error with sqlite and migrations paths', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-migration-failure-'));
    const rootDir = tempDir;
    const sqliteDirectory = path.join(rootDir, 'sqlite');
    const migrationsFolder = path.join(rootDir, 'migrations');
    fs.mkdirSync(path.join(migrationsFolder, 'meta'), { recursive: true });
    fs.writeFileSync(path.join(migrationsFolder, '0000_bad.sql'), 'CREATE TABLE broken (');
    fs.writeFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{
        idx: 0,
        version: '6',
        when: 1782799686179,
        tag: '0000_bad',
        breakpoints: true,
      }],
    }));

    const database = createDatabase({ filename: path.join(sqliteDirectory, 'megumi.sqlite3') });
    try {
      expect(() => migrateDatabase({ database, migrationsFolder })).toThrow(DatabaseMigrationError);
      migrateDatabase({ database, migrationsFolder });
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseMigrationError);
      expect((error as DatabaseMigrationError).databaseFile).toContain('megumi.sqlite3');
      expect((error as DatabaseMigrationError).migrationsFolder).toBe(migrationsFolder);
      expect((error as DatabaseMigrationError).migration).toBe('0000_bad');
      expect((error as DatabaseMigrationError).reason).toBe('sql_migration_failed');
      expect((error as Error).message).toContain('Failed to apply Database migration 0000_bad');
    } finally {
      database.close();
    }
  });
});
