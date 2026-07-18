// Verifies Drizzle migration history upgrades an existing managed DB without losing data.
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateAgentDatabase } from '@megumi/agent/persistence/schema';

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

    const first = migrateAgentDatabase({ sqliteDirectory, migrationsFolder });
    first.database.prepare('INSERT INTO upgrade_probe (id, value) VALUES (?, ?)').run('row-1', 'kept');
    first.database.close();

    fs.writeFileSync(path.join(migrationsFolder, '0001_add_note.sql'), `
      ALTER TABLE upgrade_probe ADD COLUMN note TEXT;
      --> statement-breakpoint
      UPDATE upgrade_probe SET note = 'migrated' WHERE id = 'row-1';
    `);
    writeJournal(migrationsFolder, [
      { idx: 0, tag: '0000_initial' },
      { idx: 1, tag: '0001_add_note' },
    ]);

    const second = migrateAgentDatabase({ sqliteDirectory, migrationsFolder });
    try {
      const row = second.database
        .prepare('SELECT id, value, note FROM upgrade_probe WHERE id = ?')
        .get('row-1') as { id: string; value: string; note: string };
      expect(row).toEqual({ id: 'row-1', value: 'kept', note: 'migrated' });

      const migrationCount = (second.database
        .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
        .get() as { count: number }).count;
      expect(migrationCount).toBe(2);
    } finally {
      second.database.close();
    }
  });
});
