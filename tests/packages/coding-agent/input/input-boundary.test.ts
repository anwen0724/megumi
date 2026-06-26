// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function walkSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return walkSourceFiles(fullPath);
    }

    return sourceExtensions.has(extname(entry.name)) ? [fullPath] : [];
  });
}

function relativePath(filePath: string): string {
  return relative(root, filePath).replaceAll(sep, '/');
}

describe('coding-agent input boundary', () => {
  it('exists as the Coding Agent product input sensing module', () => {
    expect(existsSync(join(root, 'packages/coding-agent/input/raw-input.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/input/parsed-input.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/input/normalizer.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/input/ids.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/input'))).toBe(false);
  });

  it('does not own agent runtime, desktop, persistence, tools, or Electron concerns', () => {
    const violations = walkSourceFiles(join(root, 'packages/coding-agent/input')).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const forbidden = [
        '@megumi/coding-agent/run',
        '@megumi/tools',
        '@megumi/db',
        '@megumi/desktop',
        'apps/desktop',
        'electron',
        'ipcMain',
        'BrowserWindow',
        'better-sqlite3',
        'ToolCall',
        'PermissionDecision',
        'SessionRepository',
      ].filter((pattern) => source.includes(pattern));

      return forbidden.map((pattern) => `${relativePath(file)} contains ${pattern}`);
    });

    expect(violations).toEqual([]);
  });
});
