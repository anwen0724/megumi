// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const forbiddenDirectories = [
  'packages/core',
  'packages/context-management',
  'packages/db',
  'packages/memory',
  'packages/tools',
  'packages/security',
  'tests/packages/tools',
  'tests/packages/security',
];

const forbiddenAliases = [
  '@megumi/core',
  '@megumi/context-management',
  '@megumi/db',
  '@megumi/memory',
  '@megumi/tools',
  '@megumi/security',
];

const configFiles = [
  'tsconfig.json',
  'vite.main.config.ts',
  'vite.preload.config.ts',
  'vite.renderer.config.ts',
  'vitest.config.ts',
  'package.json',
];

describe('old package removal', () => {
  it('removes old package directories from the repository', () => {
    const existing = forbiddenDirectories.filter((directory) =>
      fs.existsSync(path.join(root, directory)),
    );

    expect(existing).toEqual([]);
  });

  it('removes old aliases and scripts from config files', () => {
    const violations: string[] = [];

    for (const file of configFiles) {
      const absolutePath = path.join(root, file);
      const source = fs.readFileSync(absolutePath, 'utf8');

      for (const alias of forbiddenAliases) {
        if (source.includes(alias)) {
          violations.push(`${file} contains forbidden package alias ${alias}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
