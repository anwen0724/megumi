import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const forbiddenPackage = ['@megumi', 'shared'].join('/');
const checkedRoots = ['apps', 'packages', 'tests'].map((item) => path.join(root, item));

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

describe('shared package removal', () => {
  it('does not import the removed shared package', () => {
    const offenders = checkedRoots
      .flatMap(files)
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => fs.readFileSync(file, 'utf8').includes(forbiddenPackage));

    expect(offenders).toEqual([]);
  });

  it('does not keep the removed shared package directory', () => {
    expect(fs.existsSync(path.join(root, 'packages', 'shared'))).toBe(false);
  });
});
