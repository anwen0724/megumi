// Verifies migration folder resolution stays independent from any UI shell.
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPersistenceMigrationsFolder,
  resolvePersistenceMigrationsFolder,
} from '@megumi/coding-agent/persistence/schema';

let tempDir: string | null = null;

function createMigrationFolder(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-migration-paths-'));
  const folder = path.join(tempDir, 'migrations');
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({
    version: '7',
    dialect: 'sqlite',
    entries: [],
  }));
  return folder;
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('resolvePersistenceMigrationsFolder', () => {
  it('uses an explicit override after validating Drizzle journal metadata', () => {
    const folder = createMigrationFolder();

    expect(resolvePersistenceMigrationsFolder({ migrationsFolder: folder })).toBe(folder);
  });

  it('throws a clear error when the folder is missing', () => {
    const missingFolder = path.join(os.tmpdir(), 'megumi-missing-migrations');

    expect(() => assertPersistenceMigrationsFolder(missingFolder)).toThrow(
      /Persistence migrations folder is missing/,
    );
  });

  it('throws a clear error when the Drizzle journal is missing', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-missing-journal-'));

    expect(() => assertPersistenceMigrationsFolder(tempDir as string)).toThrow(
      /Drizzle migration journal is missing/,
    );
  });
});
