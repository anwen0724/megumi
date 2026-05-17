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

describe('agent run modes and plan artifact source guards', () => {
  it('keeps shared run mode contracts platform-independent', () => {
    const offenders = filesUnder('packages/shared')
      .filter((file) => /agent-run-mode-contracts|run-mode-contracts/.test(projectPath(file)))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/core|@megumi\/desktop|fs|node:fs|path|node:path)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps core run mode runtime free of Host privileges and concrete persistence', () => {
    const offenders = filesUnder('packages/core')
      .filter((file) => projectPath(file).includes('run-runtime'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/desktop|fs|node:fs|child_process|node:child_process|node:http|node:https|node:net)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not define plan as an AgentAction kind', () => {
    const contracts = readProjectFile(join(ROOT, 'packages/shared/session-run-contracts.ts'));

    expect(contracts).toContain("'create_artifact'");
    expect(contracts).not.toMatch(/RUN_ACTION_KINDS[\s\S]*['"]plan['"]/);
  });

  it('keeps only default and plan permission modes active in 04', () => {
    const source = readProjectFile(join(ROOT, 'packages/shared/run-mode-contracts.ts'));

    expect(source).toContain("export const ACTIVE_PERMISSION_MODES = ['default', 'plan'] as const");
    expect(source).toContain("'accept_edits'");
    expect(source).toContain("'auto'");
    expect(source).toContain("'bypass_permissions'");
    expect(source).not.toMatch(/ACTIVE_PERMISSION_MODES[\s\S]*accept_edits/);
    expect(source).not.toMatch(/ACTIVE_PERMISSION_MODES[\s\S]*auto/);
    expect(source).not.toMatch(/ACTIVE_PERMISSION_MODES[\s\S]*bypass_permissions/);
  });

  it('does not implement future tool approval sandbox checkpoint memory or generic artifact systems in 04 files', () => {
    const runModeFiles = [
      ...filesUnder('packages/shared'),
      ...filesUnder('packages/core'),
      ...filesUnder('packages/db'),
      ...filesUnder('apps/desktop/src/main'),
      ...filesUnder('apps/desktop/src/renderer'),
    ].filter((file) => /agent-run-mode|run-mode|agent-plan|plan\.handler/.test(projectPath(file)));

    const forbiddenPatterns = [
      /ToolCall/,
      /tool registry/i,
      /tool executor/i,
      /approval workflow/i,
      /policy evaluator/i,
      /sandbox evaluator/i,
      /checkpoint restore/i,
      /artifact content/i,
      /artifact version/i,
      /artifact render/i,
      /artifact export/i,
      /memory candidate/i,
      /long-term memory/i,
      /MCP client/i,
      /connector/i,
      /multi-agent/i,
      /handoff/i,
      /parallel subagents/i,
    ];

    const offenders = runModeFiles
      .filter((file) => forbiddenPatterns.some((pattern) => pattern.test(readProjectFile(file))))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps renderer run mode code behind typed preload and away from Host privileges', () => {
    const offenders = filesUnder('apps/desktop/src/renderer')
      .filter((file) => projectPath(file).includes('agent-run-mode'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|@megumi\/core|@megumi\/db|fs|node:fs|child_process|node:child_process)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not expose raw prompts, restricted content, or plaintext secrets through run mode boundaries', () => {
    const runModeFiles = [
      ...filesUnder('packages'),
      ...filesUnder('apps/desktop/src'),
    ].filter((file) => /agent-run-mode|run-mode|agent-plan|plan\.handler/.test(projectPath(file)));

    const forbiddenPatterns = [
      /raw full prompt/i,
      /raw restricted file content/i,
      /plaintext secret/i,
      /exactPromptInputSnapshot/,
      /packedModelInputSnapshot/,
      /sk-test-[A-Za-z0-9_-]{8,}/,
      /BEGIN (RSA |OPENSSH |PRIVATE )?KEY/,
    ];

    const offenders = runModeFiles
      .filter((file) => forbiddenPatterns.some((pattern) => pattern.test(readProjectFile(file))))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });
});
