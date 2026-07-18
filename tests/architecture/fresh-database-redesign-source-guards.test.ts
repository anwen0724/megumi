// Guards the database foundation rule: schema changes are handled by Drizzle migrations only.
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const checkedFiles = [
  'packages/agent/persistence/schema/migrate.ts',
  'packages/agent/persistence/migrations/0000_database_foundation_redesign.sql',
];

describe('database foundation source guards', () => {
  it('does not keep old-table inventory, reset logic or in-place table rewrite logic', () => {
    const combinedSource = checkedFiles.map(read).join('\n');

    expect(combinedSource).not.toContain('legacyDatabaseTables');
    expect(combinedSource).not.toContain('isLegacyDatabaseTable');
    expect(combinedSource).not.toContain('resetLegacyDatabase');
    expect(combinedSource).not.toContain('resetDatabaseForRedesign');
    expect(combinedSource).not.toContain('resetUnmanagedDatabase');
    expect(combinedSource).not.toContain('removedDatabasePath');
    expect(combinedSource).not.toContain('backupPath');
    expect(combinedSource).not.toContain('backups');
    expect(combinedSource).not.toContain('rmSync');
    expect(combinedSource).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(combinedSource).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(combinedSource).not.toMatch(/\bINSERT\s+INTO\b[\s\S]*?\bSELECT\b/i);
  });

  it('uses Drizzle runtime migrations as the only schema upgrade mechanism', () => {
    const migrateSource = read('packages/agent/persistence/schema/migrate.ts');

    expect(migrateSource).toContain('drizzle-orm/better-sqlite3/migrator');
    expect(migrateSource).toContain('migrate(drizzle(database)');
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}
