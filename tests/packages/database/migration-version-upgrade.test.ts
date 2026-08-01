// Verifies Drizzle migration history upgrades an existing managed DB without losing data.
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/database/src';

let tempDir: string | null = null;

function writeJournal(folder: string, entries: Array<{ idx: number; tag: string }>): void {
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({
    version: '7',
    dialect: 'sqlite',
    entries: entries.map((entry) => ({
      idx: entry.idx,
      version: '6',
      when: 1782799686179 + entry.idx,
      tag: entry.tag,
      breakpoints: true,
    })),
  }));
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('versioned database migrations', () => {
  it('applies only pending migrations and preserves existing data', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-versioned-migrations-'));
    const sqliteDirectory = path.join(tempDir, 'sqlite');
    const migrationsFolder = path.join(tempDir, 'migrations');
    fs.mkdirSync(migrationsFolder, { recursive: true });

    fs.writeFileSync(path.join(migrationsFolder, '0000_initial.sql'), `
      CREATE TABLE upgrade_probe (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    writeJournal(migrationsFolder, [{ idx: 0, tag: '0000_initial' }]);

    const first = openDatabase(sqliteDirectory);
    migrateDatabase({ database: first, migrationsFolder });
    first.prepare({ sql: 'INSERT INTO upgrade_probe (id, value) VALUES (?, ?)' }).run(['row-1', 'kept']);
    first.close();

    fs.writeFileSync(path.join(migrationsFolder, '0001_add_note.sql'), `
      ALTER TABLE upgrade_probe ADD COLUMN note TEXT;
      --> statement-breakpoint
      UPDATE upgrade_probe SET note = 'migrated' WHERE id = 'row-1';
    `);
    writeJournal(migrationsFolder, [
      { idx: 0, tag: '0000_initial' },
      { idx: 1, tag: '0001_add_note' },
    ]);

    const second = openDatabase(sqliteDirectory);
    try {
      migrateDatabase({ database: second, migrationsFolder });
      const row = second.prepare<{ id: string; value: string; note: string }>({
        sql: 'SELECT id, value, note FROM upgrade_probe WHERE id = ?',
      }).get(['row-1']);
      expect(row).toEqual({ id: 'row-1', value: 'kept', note: 'migrated' });

      const migrationCount = second.prepare<{ count: number }>({
        sql: 'SELECT COUNT(*) AS count FROM __drizzle_migrations',
      }).get()!.count;
      expect(migrationCount).toBe(2);
    } finally {
      second.close();
    }
  });

  it('removes populated Artifact and Memory tables from an existing database', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-remove-artifact-memory-'));
    const sqliteDirectory = path.join(tempDir, 'sqlite');
    const migrationsFolder = path.join(tempDir, 'migrations');
    fs.mkdirSync(migrationsFolder, { recursive: true });

    fs.writeFileSync(path.join(migrationsFolder, '0000_removed_capabilities.sql'), `
      CREATE TABLE artifacts (
        artifact_id TEXT PRIMARY KEY,
        current_version_id TEXT REFERENCES artifact_versions(artifact_version_id) ON DELETE SET NULL
      );
      --> statement-breakpoint
      CREATE TABLE artifact_versions (
        artifact_version_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE
      );
      --> statement-breakpoint
      CREATE TABLE artifact_source_refs (
        source_ref_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
        artifact_version_id TEXT REFERENCES artifact_versions(artifact_version_id) ON DELETE CASCADE
      );
      --> statement-breakpoint
      CREATE TABLE memory_records (
        memory_id TEXT PRIMARY KEY,
        superseded_by_id TEXT REFERENCES memory_records(memory_id) ON DELETE SET NULL
      );
      --> statement-breakpoint
      CREATE TABLE memory_markdown_mirrors (
        mirror_id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL REFERENCES memory_records(memory_id) ON DELETE CASCADE
      );
    `);
    writeJournal(migrationsFolder, [{ idx: 0, tag: '0000_removed_capabilities' }]);

    const first = openDatabase(sqliteDirectory);
    migrateDatabase({ database: first, migrationsFolder });
    first.prepare({ sql: 'INSERT INTO artifacts (artifact_id) VALUES (?)' }).run(['artifact:1']);
    first.prepare({ sql: 'INSERT INTO artifact_versions (artifact_version_id, artifact_id) VALUES (?, ?)' }).run(['version:1', 'artifact:1']);
    first.prepare({ sql: 'UPDATE artifacts SET current_version_id = ? WHERE artifact_id = ?' }).run(['version:1', 'artifact:1']);
    first.prepare({ sql: 'INSERT INTO artifact_source_refs (source_ref_id, artifact_id, artifact_version_id) VALUES (?, ?, ?)' }).run(['source:1', 'artifact:1', 'version:1']);
    first.prepare({ sql: 'INSERT INTO memory_records (memory_id) VALUES (?)' }).run(['memory:1']);
    first.prepare({ sql: 'INSERT INTO memory_records (memory_id, superseded_by_id) VALUES (?, ?)' }).run(['memory:2', 'memory:1']);
    first.prepare({ sql: 'INSERT INTO memory_markdown_mirrors (mirror_id, memory_id) VALUES (?, ?)' }).run(['mirror:1', 'memory:1']);
    first.close();

    fs.copyFileSync(
      path.join(process.cwd(), 'packages/database/migrations/0006_remove_artifact_memory.sql'),
      path.join(migrationsFolder, '0001_remove_artifact_memory.sql'),
    );
    writeJournal(migrationsFolder, [
      { idx: 0, tag: '0000_removed_capabilities' },
      { idx: 1, tag: '0001_remove_artifact_memory' },
    ]);

    const second = openDatabase(sqliteDirectory);
    try {
      migrateDatabase({ database: second, migrationsFolder });
      const remaining = second.prepare<{ name: string }>({ sql: `
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND (name LIKE 'artifact%' OR name LIKE 'memory%')
      ` }).all().map((row) => row.name);
      expect(remaining).toEqual([]);
      expect(second.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
    } finally {
      second.close();
    }
  });
});

function openDatabase(sqliteDirectory: string): DatabaseConnection {
  return createDatabase({ filename: path.join(sqliteDirectory, 'megumi.sqlite3') });
}
