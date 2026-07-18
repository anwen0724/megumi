// Guards the database migration runtime boundary.
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const migrationRuntimeFiles = [
  'packages/agent/persistence/schema/migrate.ts',
  'packages/agent/persistence/schema/migration-paths.ts',
  'packages/agent/composition/compose-agent-persistence.ts',
];

describe('database migration runtime contract', () => {
  it('does not implement old DB reset, backup, delete, or row-copy compatibility', () => {
    const source = migrationRuntimeFiles
      .filter((file) => fs.existsSync(path.join(root, file)))
      .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
      .join('\n');

    expect(source).not.toContain('resetLegacyDatabase');
    expect(source).not.toContain('resetDatabaseForRedesign');
    expect(source).not.toContain('resetUnmanagedDatabase');
    expect(source).not.toContain('legacyDatabaseTables');
    expect(source).not.toContain('isLegacyDatabaseTable');
    expect(source).not.toContain('backupPath');
    expect(source).not.toContain('backups');
    expect(source).not.toMatch(/rmSync\s*\(\s*.*sqlite/i);
    expect(source).not.toMatch(/\bALTER\s+TABLE\b[\s\S]*\bSELECT\b/i);
    expect(source).not.toMatch(/\bINSERT\s+INTO\b[\s\S]*\bSELECT\b/i);
  });

  it('uses Drizzle migrations as the only schema upgrade mechanism', () => {
    const migrateSource = fs.readFileSync(
      path.join(root, 'packages/agent/persistence/schema/migrate.ts'),
      'utf8',
    );

    expect(migrateSource).toContain('drizzle-orm/better-sqlite3/migrator');
    expect(migrateSource).toContain('migrate(drizzle(database)');
  });
});
