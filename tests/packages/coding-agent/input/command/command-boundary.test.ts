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

describe('coding-agent command input boundary', () => {
  it('exists as the Coding Agent explicit command input module', () => {
    expect(existsSync(join(root, 'packages/coding-agent/input/command/definition.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/input/command/registry.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/input/command/parser.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/input/command/dispatcher.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/input/command/built-ins.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/command'))).toBe(false);
  });

  it('does not own agent runtime, desktop, tools, persistence, shell execution, or Electron concerns', () => {
    const violations = walkSourceFiles(join(root, 'packages/coding-agent/input/command')).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const forbidden = [
        '@megumi/agent',
        '@megumi/tools',
        '@megumi/db',
        '@megumi/desktop',
        'apps/desktop',
        'electron',
        'ipcMain',
        'BrowserWindow',
        'better-sqlite3',
        'child_process',
        'execFile',
        'spawn',
      ].filter((pattern) => source.includes(pattern));

      return forbidden.map((pattern) => `${relativePath(file)} contains ${pattern}`);
    });

    expect(violations).toEqual([]);
  });
});
