// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function term(...parts: string[]): string {
  return parts.join('');
}

const scannedRoots = [
  'apps/desktop/src/main',
  'tests/apps/desktop/main',
];

const forbiddenPatterns = [
  new RegExp(term('\\bmigrate', 'Legacy', 'RuntimeDataToMegumiHome\\b')),
  new RegExp(term('\\bMegumiHome', 'Migration\\b')),
  new RegExp(term('\\blegacy', 'UserDataPath\\b')),
  new RegExp(term('app\\.getPath\\([\'"]', 'userData', '[\'"]\\)')),
  new RegExp(term('secret_', 'provider-api-key_')),
];

const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function walkFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }

    if (textExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function relativePath(filePath: string): string {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

describe('migration compatibility removal', () => {
  it('does not keep automatic old userData migration paths in active main code', () => {
    const violations: string[] = [];

    for (const scannedRoot of scannedRoots) {
      for (const file of walkFiles(path.join(root, scannedRoot))) {
        if (relativePath(file) === 'tests/architecture/no-legacy-migration-compatibility.test.ts') {
          continue;
        }

        const source = fs.readFileSync(file, 'utf8');

        for (const pattern of forbiddenPatterns) {
          if (pattern.test(source)) {
            violations.push(`${relativePath(file)} matches forbidden migration pattern`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps Agent database schema and migrations in the product core', () => {
    expect(fs.existsSync(path.join(root, 'packages/agent/persistence/schema/drizzle-schema.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'packages/agent/persistence/schema/migrate.ts'))).toBe(true);

    const oldMigrationPath = path.join(root, 'packages/agent/persistence/schema/migrations.ts');
    if (fs.existsSync(oldMigrationPath)) {
      expect(fs.readFileSync(oldMigrationPath, 'utf8')).not.toContain('export function migrateDatabase');
    }
  });

  it('does not let the desktop shell own database schema, migrations, or repositories', () => {
    const violations: string[] = [];
    const forbiddenImports = ['drizzle-orm', 'drizzle-kit', 'persistence/schema', 'persistence/repos'];

    for (const file of walkFiles(path.join(root, 'apps/desktop'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const forbiddenImport of forbiddenImports) {
        if (source.includes(forbiddenImport)) {
          violations.push(`${relativePath(file)} imports ${forbiddenImport}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
