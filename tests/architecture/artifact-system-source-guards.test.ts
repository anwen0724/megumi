// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function listFiles(dir: string): string[] {
  const result: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === '.claude' || entry === 'worktrees') {
        continue;
      }
      result.push(...listFiles(fullPath));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry)) {
      result.push(fullPath);
    }
  }

  return result;
}

function readProjectFile(path: string): string {
  return readFileSync(path, 'utf8');
}

function projectPath(path: string): string {
  return relative(ROOT, path).replace(/\\/g, '/');
}

function filesUnder(path: string): string[] {
  return listFiles(join(ROOT, path));
}

describe('artifact system source guards', () => {
  it('keeps shared artifact contracts platform-independent', () => {
    const offenders = filesUnder('packages/shared')
      .filter((file) => projectPath(file).includes('artifact-contracts'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/core|@megumi\/desktop|fs|node:fs|path|node:path)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps core artifact helpers free of Host privileges and persistence', () => {
    const offenders = [
      ...filesUnder('packages/agent'),
      ...filesUnder('packages/coding-agent'),
    ]
      .filter((file) => projectPath(file).includes('artifact') || projectPath(file).includes('plan-artifact'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/desktop|fs|node:fs|path|node:path|child_process|node:child_process)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps renderer artifact code behind preload and away from Host file access', () => {
    const offenders = filesUnder('apps/desktop/src/renderer')
      .filter((file) => projectPath(file).includes('entities/artifact'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|@megumi\/core|@megumi\/db|fs|node:fs|path|node:path|child_process|node:child_process)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not expose Megumi Home artifact content paths through renderer artifact UI', () => {
    const offenders = filesUnder('apps/desktop/src/renderer')
      .filter((file) => projectPath(file).includes('artifact'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /\bcontentKey\b|\bartifactRoot\b|\bmegumiHome\b|\bfilePath\b|\babsolutePath\b/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not implement future artifact editing export publish memory or tool execution capabilities', () => {
    const artifactFiles = [
      ...filesUnder('packages/shared'),
      ...filesUnder('packages/agent'),
      ...filesUnder('packages/coding-agent'),
      ...filesUnder('apps/desktop/src/main/persistence'),
      ...filesUnder('apps/desktop/src/main'),
      ...filesUnder('apps/desktop/src/preload'),
      ...filesUnder('apps/desktop/src/renderer'),
    ].filter((file) => /artifact|Artifact/.test(projectPath(file)) || /artifact|Artifact/.test(readProjectFile(file)));

    const forbiddenPatterns = [
      /inline comment/i,
      /selection edit/i,
      /rich editor/i,
      /render sandbox/i,
      /artifact export/i,
      /publish artifact/i,
      /share artifact/i,
      /memory candidate/i,
      /long-term memory/i,
      /MCP client/i,
      /connector/i,
      /execute artifact/i,
      /run artifact/i,
      /open external editor/i,
      /workspace file snapshot/i,
      /git patch storage/i,
    ];

    const offenders = artifactFiles
      .filter((file) => forbiddenPatterns.some((pattern) => pattern.test(readProjectFile(file))))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps artifact content refs from becoming raw prompt or secret containers', () => {
    const artifactFiles = [
      ...filesUnder('packages'),
      ...filesUnder('apps/desktop/src'),
    ].filter((file) => /artifact|Artifact/.test(projectPath(file)));

    const forbiddenPatterns = [
      /raw full prompt/i,
      /raw restricted file content/i,
      /plaintext secret/i,
      /raw provider body/i,
      /raw stack/i,
      /raw cause/i,
      /exactPromptInputSnapshot/,
      /packedModelInputSnapshot/,
      /sk-test-[A-Za-z0-9_-]{8,}/,
      /BEGIN (RSA |OPENSSH |PRIVATE )?KEY/,
    ];

    const offenders = artifactFiles
      .filter((file) => forbiddenPatterns.some((pattern) => pattern.test(readProjectFile(file))))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });
});
