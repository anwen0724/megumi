// Guards owner modules from persistence/host details and keeps database as repository infrastructure.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);

function listSourceFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  return readdirSync(absoluteDirectory).flatMap((entry) => {
    const absolute = path.join(absoluteDirectory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      return listSourceFiles(path.relative(repoRoot, absolute));
    }
    return sourceExtensions.has(path.extname(entry)) ? [path.relative(repoRoot, absolute).replaceAll(path.sep, '/')] : [];
  });
}

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function concat(files: string[]): string {
  return files.map(read).join('\n');
}

describe('src owner modules and database boundaries', () => {
  it('keeps owner modules independent from database, desktop, ui, Electron, and SQLite implementation', () => {
    const ownerSource = concat([
      ...listSourceFiles('src/agent'),
      ...listSourceFiles('src/ai'),
      ...listSourceFiles('src/input'),
      ...listSourceFiles('src/command'),
      ...listSourceFiles('src/context'),
      ...listSourceFiles('src/permission'),
      ...listSourceFiles('src/session'),
      ...listSourceFiles('src/tools'),
      ...listSourceFiles('src/workspace'),
    ]);

    for (const forbidden of [
      '../database',
      '../../database',
      '../desktop',
      '../../desktop',
      '../ui',
      '../../ui',
      'better-sqlite3',
      'electron',
      'node:fs',
      'node:child_process',
      'child_process',
      'apps/desktop',
      'packages/',
    ]) {
      expect(ownerSource).not.toContain(forbidden);
    }
  });

  it('keeps database out of desktop, ui, and owner-rule execution', () => {
    const databaseSource = concat(listSourceFiles('src/database'));

    for (const forbidden of [
      '../desktop',
      '../../desktop',
      '../ui',
      '../../ui',
      'electron',
      'createAgentRunner',
      'buildModelContextInput',
      'streamAssistantMessage',
      'preflightToolCall',
      'evaluatePermissionPolicy(',
      'createBuiltInToolRegistry',
      'createToolExecutionService',
    ]) {
      expect(databaseSource).not.toContain(forbidden);
    }
  });
});
