// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function term(...parts: string[]): string {
  return parts.join('');
}

const activeRoots = [
  'apps/desktop/src',
  'packages/shared',
  'packages/ai',
  'packages/agent',
  'packages/input',
  'packages/command',
  'packages/coding-agent',
  'tests/apps',
  'tests/packages/shared',
  'tests/packages/ai',
  'tests/packages/agent',
  'tests/packages/input',
  'tests/packages/command',
  'tests/packages/coding-agent',
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
  new RegExp(term('@megumi\\/', 'legacy\\/')),
  new RegExp(term('\\bPROJECT', '_')),
  new RegExp(term('\\bSTAGE', '_')),
  new RegExp(term('\\bMESSAGE', '_')),
  new RegExp(term('\\bARTIFACT', '_')),
  new RegExp(term('\\bEXPORT', '_')),
  new RegExp(term('\\bregister', 'Project', 'Handlers\\b')),
  new RegExp(term('\\bregister', 'Stage', 'Handlers\\b')),
  new RegExp(term('\\bregister', 'Message', 'Handlers\\b')),
  new RegExp(term('\\bregister', 'Artifact', 'Handlers\\b')),
  new RegExp(term('\\bregister', 'Export', 'Handlers\\b')),
  new RegExp(term('\\bStage', 'Instance\\b')),
  new RegExp(term('\\bStage', 'Type\\b')),
  new RegExp(term('\\bStage', 'Status\\b')),
  new RegExp(term('\\bstage', 'InstanceId\\b')),
  new RegExp(term('\\bactive', 'StageId\\b')),
  new RegExp(term('\\blist', 'Stages\\b')),
  new RegExp(term('\\bset', 'Stages\\b')),
];

const allowedCurrentLifecycleTerms = new Map<string, RegExp[]>([
  ['packages/shared/session/run-contracts.ts', [
    new RegExp(term('\\bMESSAGE', '_')),
  ]],
  ['packages/shared/artifact/contracts.ts', [
    new RegExp(term('\\bARTIFACT', '_')),
  ]],
  ['tests/packages/shared/artifact/contracts.test.ts', [
    new RegExp(term('\\bARTIFACT', '_')),
  ]],
  ['apps/desktop/src/main/ipc/handlers/artifact.handler.ts', [
    new RegExp(term('\\bregister', 'Artifact', 'Handlers\\b')),
  ]],
  ['apps/desktop/src/main/ipc/handlers/project.handler.ts', [
    new RegExp(term('\\bregister', 'Project', 'Handlers\\b')),
  ]],
  ['apps/desktop/src/main/ipc/register-ipc-handlers.ts', [
    new RegExp(term('\\bregister', 'Artifact', 'Handlers\\b')),
    new RegExp(term('\\bregister', 'Project', 'Handlers\\b')),
  ]],
  ['tests/apps/desktop/main/ipc/handlers/artifact.handler.test.ts', [
    new RegExp(term('\\bregister', 'Artifact', 'Handlers\\b')),
  ]],
  ['tests/apps/desktop/main/ipc/handlers/project.handler.test.ts', [
    new RegExp(term('\\bregister', 'Project', 'Handlers\\b')),
  ]],
  ['tests/apps/desktop/main/ipc/register-ipc-handlers.test.ts', [
    new RegExp(term('\\bregister', 'Artifact', 'Handlers\\b')),
    new RegExp(term('\\bregister', 'Project', 'Handlers\\b')),
  ]],
  ['packages/shared/project/contracts.ts', [
    new RegExp(term('\\bPROJECT', '_')),
  ]],
]);

function walkFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
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

function isAllowedCurrentLifecycleTerm(relative: string, pattern: RegExp): boolean {
  return allowedCurrentLifecycleTerms.get(relative)?.some((allowedPattern) => {
    allowedPattern.lastIndex = 0;
    pattern.lastIndex = 0;
    return allowedPattern.source === pattern.source;
  }) ?? false;
}

describe('active old-runtime boundary', () => {
  it('keeps active app and clean packages disconnected from old runtime code', () => {
    const violations: string[] = [];

    for (const activeRoot of activeRoots) {
      const absoluteRoot = path.join(root, activeRoot);

      for (const file of walkFiles(absoluteRoot)) {
        const relative = relativePath(file);
        const source = fs.readFileSync(file, 'utf8');

        for (const pattern of forbiddenPatterns) {
          if (isAllowedCurrentLifecycleTerm(relative, pattern)) {
            continue;
          }

          if (pattern.test(source)) {
            violations.push(`${relative} matches forbidden old-runtime pattern`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('does not scan removed reference locations', () => {
    const scannedRoots = activeRoots.map((entry) => entry.replaceAll('\\', '/'));

    expect(scannedRoots).not.toContain(term('packages/', 'legacy'));
    expect(scannedRoots).not.toContain(term('tests/packages/', 'legacy'));
    expect(scannedRoots).not.toContain('docs/archive');
    expect(scannedRoots).not.toContain('docs/research');
  });
});
