/* Prevents Daily Recommendation from regaining Source, Search, or Candidate Supply execution dependencies. */
// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), 'packages/agent/discovery/src/daily-recommendation');

describe('Daily Recommendation source boundary', () => {
  it('contains no Source, Search, or Candidate Supply execution imports', () => {
    const source = sourceFiles(root)
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/from ['"][^'"]*\/sources\//u);
    expect(source).not.toContain('search_content');
    expect(source).not.toContain('read_source_candidate');
    expect(source).not.toMatch(/candidate-supply-(?:runtime|attempts)/u);
  });
});

function sourceFiles(directoryPath: string): string[] {
  return readdirSync(directoryPath).flatMap((name) => {
    const entryPath = path.join(directoryPath, name);
    return statSync(entryPath).isDirectory()
      ? sourceFiles(entryPath)
      : entryPath.endsWith('.ts') ? [entryPath] : [];
  });
}
