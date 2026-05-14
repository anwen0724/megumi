// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function term(...parts: string[]): string {
  return parts.join('');
}

const forbiddenDirectories = [
  term('packages/', 'legacy'),
  term('tests/packages/', 'legacy'),
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

      if (source.includes(term('@megumi/', 'legacy'))) {
        violations.push(`${file} contains forbidden package alias`);
      }

      if (source.includes(term('tests/packages/', 'legacy'))) {
        violations.push(`${file} contains forbidden package test path`);
      }
    }

    expect(violations).toEqual([]);
  });
});
