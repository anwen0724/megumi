import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const agentDir = join(process.cwd(), 'packages/agent');

describe('agent tool core boundary', () => {
  it('does not import Host privileged modules from packages/agent', () => {
    const files = collectTsFiles(agentDir);
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /from ['"](?:electron|node:fs|fs|node:child_process|child_process|better-sqlite3)['"]/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('does not import concrete desktop main services from packages/agent', () => {
    const files = collectTsFiles(agentDir);
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('apps/desktop/src/main') || source.includes('@megumi/db/repos');
    });

    expect(offenders).toEqual([]);
  });
});

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return collectTsFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}
