/*
 * Verifies release-driven migrations preserve a consistent pre-upgrade database snapshot.
 */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DatabaseDowngradeUnsupportedError,
  DatabaseMigrationError,
  createDatabase,
  migrateDatabase,
} from '../../../packages/agent/database/src';

let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('Database release upgrade safety', () => {
  it('creates and integrity-checks a snapshot before a pending migration', () => {
    const fixture = createFixture();
    writeMigrationChain(fixture.migrationsFolder, [
      { tag: '0000_initial', sql: 'CREATE TABLE upgrade_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL);' },
    ]);
    migrateWithVersion(fixture.databaseFile, fixture.migrationsFolder, '0.1.0', 0);
    const seeded = createDatabase({ filename: fixture.databaseFile });
    seeded.prepare({ sql: 'INSERT INTO upgrade_probe (id, value) VALUES (?, ?)' }).run(['row-1', 'before']);
    seeded.close();

    writeMigrationChain(fixture.migrationsFolder, [
      { tag: '0000_initial', sql: 'CREATE TABLE upgrade_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL);' },
      { tag: '0001_note', sql: 'ALTER TABLE upgrade_probe ADD COLUMN note TEXT;' },
    ]);
    const result = migrateWithVersion(fixture.databaseFile, fixture.migrationsFolder, '0.2.0', 1);

    expect(result.backupFile).toMatch(/megumi-before-upgrade-0\.1\.0-to-0\.2\.0-/);
    const backup = new BetterSqlite3(result.backupFile!, { readonly: true, fileMustExist: true });
    try {
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(backup.prepare('SELECT id, value FROM upgrade_probe').get()).toEqual({
        id: 'row-1',
        value: 'before',
      });
      expect(backup.pragma('table_info(upgrade_probe)')).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'note' })]),
      );
    } finally {
      backup.close();
    }
  });

  it('does not create an upgrade backup for a new or already-current database', () => {
    const fixture = createFixture();
    writeMigrationChain(fixture.migrationsFolder, [
      { tag: '0000_initial', sql: 'CREATE TABLE upgrade_probe (id TEXT PRIMARY KEY);' },
    ]);

    const first = migrateWithVersion(fixture.databaseFile, fixture.migrationsFolder, '0.1.0', 0);
    const repeated = migrateWithVersion(fixture.databaseFile, fixture.migrationsFolder, '0.1.1', 1);

    expect(first.backupFile).toBeUndefined();
    expect(repeated.backupFile).toBeUndefined();
    expect(fs.existsSync(path.join(path.dirname(fixture.databaseFile), 'backups'))).toBe(false);
  });

  it('keeps the failed migration backup and does not advance the application version marker', () => {
    const fixture = createFixture();
    writeMigrationChain(fixture.migrationsFolder, [
      { tag: '0000_initial', sql: 'CREATE TABLE upgrade_probe (id TEXT PRIMARY KEY);' },
    ]);
    migrateWithVersion(fixture.databaseFile, fixture.migrationsFolder, '0.1.0', 0);
    writeMigrationChain(fixture.migrationsFolder, [
      { tag: '0000_initial', sql: 'CREATE TABLE upgrade_probe (id TEXT PRIMARY KEY);' },
      { tag: '0001_broken', sql: 'CREATE TABLE broken (' },
    ]);

    const database = createDatabase({ filename: fixture.databaseFile });
    let failure: DatabaseMigrationError | undefined;
    try {
      migrateDatabase({
        database,
        migrationsFolder: fixture.migrationsFolder,
        releaseUpgrade: releaseUpgrade('0.2.0', 1),
      });
    } catch (error) {
      if (error instanceof DatabaseMigrationError) failure = error;
    } finally {
      database.close();
    }

    expect(failure?.backupFile).toBeTruthy();
    expect(fs.existsSync(failure!.backupFile!)).toBe(true);
    expect(readVersionMarker(fixture.databaseFile)).toBe('0.1.0');
  });

  it('retains only the three most recent successful pre-upgrade snapshots', () => {
    const fixture = createFixture();
    const migrations = [{ tag: '0000_initial', sql: 'CREATE TABLE upgrade_probe (id TEXT PRIMARY KEY);' }];
    writeMigrationChain(fixture.migrationsFolder, migrations);
    migrateWithVersion(fixture.databaseFile, fixture.migrationsFolder, '0.8.0', 0);

    const targetVersions = ['0.9.0', '0.10.0', '0.11.0', '0.12.0'];
    for (const [offset, targetVersion] of targetVersions.entries()) {
      const index = offset + 1;
      migrations.push({ tag: `000${index}_column`, sql: `ALTER TABLE upgrade_probe ADD COLUMN value_${index} TEXT;` });
      writeMigrationChain(fixture.migrationsFolder, migrations);
      migrateWithVersion(fixture.databaseFile, fixture.migrationsFolder, targetVersion, index);
    }

    const backups = fs.readdirSync(path.join(path.dirname(fixture.databaseFile), 'backups'));
    expect(backups).toHaveLength(3);
    expect(backups.some((name) => name.includes('0.8.0-to-0.9.0'))).toBe(false);
    expect(backups.some((name) => name.includes('0.11.0-to-0.12.0'))).toBe(true);
  });

  it('rejects a database whose migration history is newer than the bundled journal', () => {
    const fixture = createFixture();
    const migrations = [
      { tag: '0000_initial', sql: 'CREATE TABLE upgrade_probe (id TEXT PRIMARY KEY);' },
      { tag: '0001_note', sql: 'ALTER TABLE upgrade_probe ADD COLUMN note TEXT;' },
    ];
    writeMigrationChain(fixture.migrationsFolder, migrations);
    migrateWithVersion(fixture.databaseFile, fixture.migrationsFolder, '0.2.0', 0);
    writeMigrationChain(fixture.migrationsFolder, migrations.slice(0, 1));

    const database = createDatabase({ filename: fixture.databaseFile });
    try {
      expect(() => migrateDatabase({
        database,
        migrationsFolder: fixture.migrationsFolder,
        releaseUpgrade: releaseUpgrade('0.1.0', 1),
      })).toThrow(DatabaseDowngradeUnsupportedError);
    } finally {
      database.close();
    }
  });
});

function createFixture(): { databaseFile: string; migrationsFolder: string } {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-release-upgrade-'));
  return {
    databaseFile: path.join(tempRoot, 'sqlite', 'megumi.sqlite'),
    migrationsFolder: path.join(tempRoot, 'migrations'),
  };
}

function writeMigrationChain(
  folder: string,
  migrations: ReadonlyArray<{ tag: string; sql: string }>,
): void {
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  for (const [index, migration] of migrations.entries()) {
    fs.writeFileSync(path.join(folder, `${migration.tag}.sql`), migration.sql);
    if (index < migrations.length - 1) {
      // Existing files are intentionally left in place; the journal is authoritative.
    }
  }
  fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({
    version: '7',
    dialect: 'sqlite',
    entries: migrations.map((migration, index) => ({
      idx: index,
      version: '6',
      when: 1_800_000_000_000 + index,
      tag: migration.tag,
      breakpoints: true,
    })),
  }));
}

function migrateWithVersion(
  databaseFile: string,
  migrationsFolder: string,
  version: string,
  minute: number,
) {
  const database = createDatabase({ filename: databaseFile });
  try {
    return migrateDatabase({
      database,
      migrationsFolder,
      releaseUpgrade: releaseUpgrade(version, minute),
    });
  } finally {
    database.close();
  }
}

function releaseUpgrade(targetApplicationVersion: string, minute: number) {
  return {
    targetApplicationVersion,
    now: () => new Date(Date.UTC(2026, 7, 27, 0, minute, 0)),
  };
}

function readVersionMarker(databaseFile: string): string {
  const raw = JSON.parse(fs.readFileSync(`${databaseFile}.application-version.json`, 'utf8')) as {
    applicationVersion: string;
  };
  return raw.applicationVersion;
}
