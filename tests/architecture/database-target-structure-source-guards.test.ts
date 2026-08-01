/* Guards the confirmed Database Package structure and public entrypoints. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Database target structure', () => {
  it('provides the confirmed Package and source files', () => {
    expect(listFiles('packages/database/src')).toEqual([
      'database-migrations.ts',
      'database-schema.ts',
      'database-tables.ts',
      'database.ts',
      'index.ts',
      'legacy-session-history-migration.ts',
      'migration-resources.ts',
    ]);
    expect(exists('packages/database/package.json')).toBe(true);
    expect(exists('packages/database/tsconfig.json')).toBe(true);
    expect(exists('packages/database/migrations/meta/_journal.json')).toBe(true);
    expect(exists('packages/database/migrations/0000_database_foundation_redesign.sql')).toBe(true);
    expect(exists('packages/database/migrations/0007_session_attachment_order.sql')).toBe(true);
  });

  it('exports the stable Database entry and explicit physical Schema subpath', () => {
    const manifest = JSON.parse(read('packages/database/package.json')) as {
      name?: string;
      exports?: Record<string, string>;
    };
    const publicIndex = read('packages/database/src/index.ts');

    expect(manifest.name).toBe('@megumi/database');
    expect(manifest.exports).toMatchObject({
      '.': './src/index.ts',
      './schema': './src/database-schema.ts',
    });
    expect(publicIndex).toContain('createDatabase');
    expect(publicIndex).toContain('migrateDatabase');
    expect(publicIndex).not.toContain('better-sqlite3');
    expect(publicIndex).not.toContain('drizzle-orm');
  });

  it('removes the former Database location under packages/agent', () => {
    expect(exists('packages/agent/persistence')).toBe(false);
  });
});

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listFiles(relativePath: string): string[] {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  return fs.readdirSync(absolutePath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.parentPath.includes(`${path.sep}dist${path.sep}`))
    .map((entry) => path.relative(absolutePath, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}
