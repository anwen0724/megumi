// Guards renderer contracts as shared UI/desktop protocol, not owner-module implementation.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const contractsRoot = path.join(repoRoot, 'src/shared/renderer-contracts');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      return listSourceFiles(absolute);
    }
    return /\.(ts|tsx)$/.test(entry) ? [absolute] : [];
  });
}

function readSource(file: string): string {
  return readFileSync(file, 'utf8');
}

function readImportSpecifiers(): string[] {
  const source = listSourceFiles(contractsRoot).map(readSource).join('\n');
  const importPattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  return [...source.matchAll(importPattern)].map((match) => match[1]);
}

describe('src/shared/renderer-contracts boundaries', () => {
  it('does not depend on desktop, ui, app, or owner modules', () => {
    const forbidden = [
      '../../agent',
      '../../ai',
      '../../app',
      '../../command',
      '../../context',
      '../../database',
      '../../desktop',
      '../../input',
      '../../permission',
      '../../session',
      '../../tools',
      '../../workspace',
      '../../ui',
      'src/agent',
      'src/ai',
      'src/app',
      'src/command',
      'src/context',
      'src/database',
      'src/desktop',
      'src/input',
      'src/permission',
      'src/session',
      'src/tools',
      'src/workspace',
      'src/ui',
      'electron',
      'node:fs',
      'node:path',
      'node:child_process',
      'better-sqlite3',
    ];

    for (const specifier of readImportSpecifiers()) {
      expect(forbidden.some((entry) => specifier === entry || specifier.startsWith(`${entry}/`))).toBe(false);
    }
  });

  it('keeps the public barrel as the renderer contract entrypoint', () => {
    const barrel = readSource(path.join(contractsRoot, 'index.ts'));

    for (const expected of [
      './ipc',
      './renderer-api',
      './chat-stream',
      './runtime',
      './timeline',
      './session-message',
      './project',
      './settings',
      './provider',
      './workspace',
      './recovery',
      './tool',
      './permission',
    ]) {
      expect(barrel).toContain(`export * from '${expected}'`);
    }
  });
});
