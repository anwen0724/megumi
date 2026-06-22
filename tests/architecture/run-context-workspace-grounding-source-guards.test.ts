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

    if (/\.(ts|tsx|md)$/.test(entry)) {
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

describe('run context workspace grounding source guards', () => {
  it('keeps shared context contracts platform-independent', () => {
    const offenders = filesUnder('packages/shared')
      .filter((file) => projectPath(file).includes('run-context-contracts'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/core|@megumi\/desktop|fs|node:fs|path|node:path)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps agent context runtime free of Host privileges and concrete persistence', () => {
    const offenders = filesUnder('packages/agent')
      .filter((file) => projectPath(file).includes('agent-runtime'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/desktop|fs|node:fs|child_process|node:child_process|node:http|node:https|node:net)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps persistence context repository from doing relevance decisions or workspace reads', () => {
    const offenders = filesUnder('apps/desktop/src/main/persistence')
      .filter((file) => projectPath(file).includes('run-context'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](@megumi\/core|@megumi\/desktop|electron|fs|node:fs|child_process|node:child_process)/.test(source) ||
          /relevance|rankContext|scoreContext|readFile|readdir|workspace reader/i.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps renderer context code behind typed preload and away from Host privileges', () => {
    const offenders = filesUnder('apps/desktop/src/renderer')
      .filter((file) => projectPath(file).includes('run-context'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|@megumi\/core|@megumi\/db|fs|node:fs|child_process|node:child_process)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not add future Agent capabilities in context foundation files', () => {
    const contextFiles = [
      ...filesUnder('packages/shared'),
      ...filesUnder('packages/agent'),
      ...filesUnder('apps/desktop/src/main/persistence'),
      ...filesUnder('apps/desktop/src/main'),
      ...filesUnder('apps/desktop/src/renderer'),
    ].filter((file) => /run-context|context\.handler|context.service|agent-runtime/.test(projectPath(file)))
      .filter((file) => projectPath(file) !== 'packages/agent/loop/agent-loop.ts');

    const forbiddenPatterns = [
      /tool registry/i,
      /approval workflow/i,
      /policy evaluator/i,
      /sandbox evaluator/i,
      /checkpoint restore/i,
      /artifact storage/i,
      /memory candidate/i,
      /long-term memory/i,
      /MCP client/i,
      /connector/i,
      /multi-agent/i,
      /handoff/i,
      /parallel subagents/i,
    ];

    const offenders = contextFiles
      .filter((file) => forbiddenPatterns.some((pattern) => pattern.test(readProjectFile(file))))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not expose raw prompts, raw restricted content, or plaintext secrets through production context boundaries', () => {
    const contextFiles = [
      ...filesUnder('packages'),
      ...filesUnder('apps/desktop/src'),
    ].filter((file) => /run-context|context\.handler|context.service|agent-runtime/.test(projectPath(file)));

    const forbiddenPatterns = [
      /raw full prompt/i,
      /raw restricted file content/i,
      /plaintext secret/i,
      /exactPromptInputSnapshot/,
      /packedModelInputSnapshot/,
      /sk-test-[A-Za-z0-9_-]{8,}/,
      /BEGIN (RSA |OPENSSH |PRIVATE )?KEY/,
    ];

    const offenders = contextFiles
      .filter((file) => forbiddenPatterns.some((pattern) => pattern.test(readProjectFile(file))))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });
});
