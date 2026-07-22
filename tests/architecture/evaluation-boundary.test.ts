/* Guards Evaluation as removable development infrastructure outside product runtime. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();

describe('Agent Evaluation architecture boundary', () => {
  it('prevents product code from depending on evals', async () => {
    const files = await sourceFiles(path.join(repositoryRoot, 'packages'));
    const offenders = await importsMatching(files, /(?:from\s+|import\s*\()['"][^'"]*evals(?:\/|['"])/);
    expect(offenders).toEqual([]);
  });

  it('allows evals to use only Product public seams', async () => {
    const files = await sourceFiles(path.join(repositoryRoot, 'evals'));
    const offenders = await importsMatching(
      files,
      /(?:from\s+|import\s*\()['"](?:@megumi\/desktop|[^'"]*apps\/desktop|@megumi\/agent|[^'"]*packages\/agent)/,
    );
    expect(offenders).toEqual([]);
  });

  it('does not add Evaluation persistence to product migrations', async () => {
    const files = await sourceFiles(path.join(repositoryRoot, 'packages'));
    const offenders: string[] = [];
    for (const file of files.filter((candidate) => /migration|schema/i.test(candidate))) {
      const source = await readFile(file, 'utf8');
      if (/evaluation_(?:case|execution|report)|evaluation[A-Z](?:Case|Execution|Report)/.test(source)) {
        offenders.push(path.relative(repositoryRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

async function importsMatching(files: string[], pattern: RegExp): Promise<string[]> {
  const offenders: string[] = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (pattern.test(source)) offenders.push(path.relative(repositoryRoot, file));
  }
  return offenders;
}
