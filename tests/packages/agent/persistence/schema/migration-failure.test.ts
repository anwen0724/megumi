// Verifies migration failures stop runtime startup with a clear database error.
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentDatabaseMigrationError,
  migrateAgentDatabase,
} from '@megumi/agent/persistence/schema';

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

    expect(() => migrateAgentDatabase({
      sqliteDirectory,
      migrationsFolder,
    })).toThrow(AgentDatabaseMigrationError);

    try {
      migrateAgentDatabase({
        sqliteDirectory,
        migrationsFolder,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AgentDatabaseMigrationError);
      expect((error as AgentDatabaseMigrationError).sqliteFile).toContain('megumi.sqlite3');
      expect((error as AgentDatabaseMigrationError).migrationsFolder).toBe(migrationsFolder);
      expect((error as Error).message).toContain('Failed to apply Agent database migrations');
    }
  });
});
