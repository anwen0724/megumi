// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function term(...parts: string[]): string {
  return parts.join('');
}

const scannedRoots = [
  'apps/desktop/src',
  'tests/apps/desktop',
];

const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const forbiddenPatterns = [
  new RegExp(term('window\\.', 'dev', 'flow')),
  new RegExp(term('\\bDev', 'Flow', 'API\\b')),
  new RegExp(term('exposeInMainWorld\\([\'"]', 'dev', 'flow', '[\'"]')),
  new RegExp(term('Object\\.defineProperty\\(window,\\s*[\'"]', 'dev', 'flow', '[\'"]')),
];

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

describe('Megumi preload bridge identity', () => {
  it('does not expose or consume the old bridge name in active app code', () => {
    const violations: string[] = [];

    for (const scannedRoot of scannedRoots) {
      for (const file of walkFiles(path.join(root, scannedRoot))) {
        if (relativePath(file) === 'tests/architecture/megumi-bridge-identity.test.ts') {
          continue;
        }

        const source = fs.readFileSync(file, 'utf8');

        for (const pattern of forbiddenPatterns) {
          if (pattern.test(source)) {
            violations.push(`${relativePath(file)} matches forbidden bridge pattern`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
