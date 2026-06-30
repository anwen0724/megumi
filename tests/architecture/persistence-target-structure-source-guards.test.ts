// Guards the final Coding Agent persistence package structure after DB redesign.
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const expectedPersistenceChildren = [
  'connection.ts',
  'index.ts',
  'migrations',
  'repos',
  'schema',
];

const expectedRepoFiles = [
  'agent-loop.repo.ts',
  'artifact.repo.ts',
  'memory.repo.ts',
  'session.repo.ts',
  'tool-call.repo.ts',
  'workspace-change.repo.ts',
  'workspace.repo.ts',
];

const oldRepositoryImports = [
  'project.repo',
  'session-record.repo',
  'session-message.repo',
  'session-compaction.repo',
  'session-active-path.repo',
  'session-context.repo',
  'run-record.repo',
  'model-step.repo',
  'runtime-event.repo',
  'run-execution-fact.repo',
  'run-context.repo',
  'recovery.repo',
  'permission-snapshot.repo',
  'tool.repo',
  'timeline-message.repo',
];

describe('persistence target structure source guards', () => {
  it('keeps only the spec-aligned persistence package children', () => {
    const actual = fs.readdirSync(path.join(root, 'packages/coding-agent/persistence'))
      .filter((name) => !name.endsWith('.map'))
      .sort();

    expect(actual).toEqual(expectedPersistenceChildren);
  });

  it('keeps only the seven aggregate repository files', () => {
    const actual = fs.readdirSync(path.join(root, 'packages/coding-agent/persistence/repos'))
      .filter((name) => name.endsWith('.ts'))
      .sort();

    expect(actual).toEqual(expectedRepoFiles);
  });

  it('does not import deleted table-shaped repositories from production code', () => {
    const matches = sourceFiles(path.join(root, 'packages/coding-agent'))
      .filter((file) => !file.includes('/persistence/repos/'))
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return oldRepositoryImports
          .filter((oldImport) => importsModulePath(source, oldImport))
          .map((oldImport) => `${relativePath(file)} imports ${oldImport}`);
      });

    expect(matches).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      return [];
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(fullPath);
    }
    return /\.(ts|tsx|mts|cts)$/.test(entry.name) ? [fullPath] : [];
  });
}

function relativePath(file: string): string {
  return path.relative(root, file).replace(/\\/g, '/');
}

function importsModulePath(source: string, moduleName: string): boolean {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:import|export)\\b[^'"]*['"][^'"]*${escaped}(?:\\.ts)?['"]`).test(source);
}
