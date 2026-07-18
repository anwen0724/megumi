import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function readFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? readFiles(file) : [file];
  });
}

describe('legacy contract boundaries', () => {
  it('keeps memory legacy contracts inside memory and persistence mapping', () => {
    const offenders = readFiles(path.join(root, 'packages/agent'))
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !file.includes(`${path.sep}memory${path.sep}`))
      .filter((file) => !file.endsWith(`${path.sep}persistence${path.sep}repos${path.sep}memory.repo.ts`))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('memory/legacy-contracts'));

    expect(offenders).toEqual([]);
  });

  it('keeps artifact legacy contracts inside artifacts and persistence mapping', () => {
    const offenders = readFiles(path.join(root, 'packages/agent'))
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !file.includes(`${path.sep}artifacts${path.sep}`))
      .filter((file) => !file.endsWith(`${path.sep}persistence${path.sep}repos${path.sep}artifact.repo.ts`))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('artifacts/legacy-contracts'));

    expect(offenders).toEqual([]);
  });
});
