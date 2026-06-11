// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const scannedRoots = [
  'AGENTS.md',
  'apps',
  'config',
  'docs',
  'packages',
  'scripts',
  'tests',
  'tsconfig.json',
  'vite.main.config.ts',
  'vite.preload.config.ts',
  'vite.renderer.config.ts',
  'vitest.config.ts',
  'package.json',
];

const ignoredPathParts = [
  'node_modules',
  '.git',
  '.vite',
  'out',
  'dist',
  'coverage',
];

const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.toml',
]);

function joinForbidden(...parts: string[]): string {
  return parts.join('');
}

const forbiddenTerms = [
  joinForbidden('dev', 'flow'),
  joinForbidden('Dev', 'Flow'),
  joinForbidden('DEV', 'FLOW'),
  joinForbidden('window.', 'dev', 'flow'),
  joinForbidden('Dev', 'Flow', 'API'),
  joinForbidden('@megumi/', 'legacy'),
  joinForbidden('packages/', 'legacy'),
  joinForbidden('tests/packages/', 'legacy'),
  joinForbidden('Stage', 'Instance'),
  joinForbidden('Stage', 'Type'),
  joinForbidden('Stage', 'Status'),
  joinForbidden('stage', 'InstanceId'),
  joinForbidden('active', 'StageId'),
  joinForbidden('list', 'Stages'),
  joinForbidden('set', 'Stages'),
  joinForbidden('PROJECT', '_'),
  joinForbidden('STAGE', '_'),
  joinForbidden('MESSAGE', '_'),
  joinForbidden('ARTIFACT', '_'),
  joinForbidden('EXPORT', '_'),
];

const allowedCurrentLifecycleTerms = new Map<string, string[]>([
  ['packages/shared/session-run-contracts.ts', [
    joinForbidden('MESSAGE', '_'),
  ]],
  ['packages/shared/session-run-contracts.ts', [
    joinForbidden('MESSAGE', '_'),
  ]],
  ['packages/shared/timeline-message-blocks.ts', [
    joinForbidden('MESSAGE', '_'),
  ]],
  ['packages/shared/timeline-message-block-schemas.ts', [
    joinForbidden('MESSAGE', '_'),
  ]],
  ['tests/packages/shared/timeline-message-blocks.test.ts', [
    joinForbidden('MESSAGE', '_'),
  ]],
  ['tests/architecture/timeline-message-block-source-guards.test.ts', [
    joinForbidden('MESSAGE', '_'),
  ]],
  ['packages/shared/permission-snapshot-contracts.ts', [
    joinForbidden('ARTIFACT', '_'),
  ]],
  ['packages/shared/artifact-contracts.ts', [
    joinForbidden('ARTIFACT', '_'),
  ]],
  ['tests/packages/shared/artifact-contracts.test.ts', [
    joinForbidden('ARTIFACT', '_'),
  ]],
  ['packages/shared/project-contracts.ts', [
    joinForbidden('PROJECT', '_'),
  ]],
  ['tests/apps/desktop/renderer/shell/AppBody.test.tsx', [
    joinForbidden('PROJECT', '_'),
  ]],
  ['AGENTS.md', [
    joinForbidden('PROJECT', '_'),
  ]],
]);

function shouldIgnore(filePath: string): boolean {
  const normalized = filePath.replaceAll(path.sep, '/');
  return ignoredPathParts.some((part) => normalized.includes(`/${part}/`));
}

function walkFiles(entryPath: string): string[] {
  const absolutePath = path.join(root, entryPath);

  if (!fs.existsSync(absolutePath) || shouldIgnore(absolutePath)) {
    return [];
  }

  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    return textExtensions.has(path.extname(absolutePath)) ? [absolutePath] : [];
  }

  const files: string[] = [];

  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const fullPath = path.join(absolutePath, entry.name);

    if (shouldIgnore(fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...walkFiles(path.relative(root, fullPath)));
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

describe('old project residue guard', () => {
  it('keeps the current repository free of old project names, packages, and stage-era runtime symbols', () => {
    const violations: string[] = [];

    for (const scannedRoot of scannedRoots) {
      for (const file of walkFiles(scannedRoot)) {
        const relative = relativePath(file);

        if (relative === 'tests/architecture/no-old-project-residue.test.ts') {
          continue;
        }

        const source = fs.readFileSync(file, 'utf8');

        for (const term of forbiddenTerms) {
          if (allowedCurrentLifecycleTerms.get(relative)?.includes(term)) {
            continue;
          }

          if (source.includes(term)) {
            violations.push(`${relative} contains forbidden residue term`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
