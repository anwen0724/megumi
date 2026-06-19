// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

function productionSourceFiles(): string[] {
  return [
    ...filesUnder('packages'),
    ...filesUnder('apps/desktop/src'),
  ].filter((file) => !projectPath(file).includes('/archive/'));
}

describe('run modes and plan artifact source guards', () => {
  it('keeps permission snapshot contracts platform-independent', () => {
    const offenders = filesUnder('packages/shared')
      .filter((file) => /permission-snapshot-contracts/.test(projectPath(file)))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/core|@megumi\/desktop|fs|node:fs|path|node:path)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps core run mode runtime free of Host privileges and concrete persistence', () => {
    const offenders = filesUnder('packages/core')
      .filter((file) => projectPath(file).includes('agent-runtime'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/desktop|fs|node:fs|child_process|node:child_process|node:http|node:https|node:net)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not define plan as an AgentAction kind', () => {
    const contracts = readProjectFile(join(ROOT, 'packages/shared/session/run-contracts.ts'));

    expect(contracts).toContain("'create_artifact'");
    expect(contracts).not.toMatch(/RUN_ACTION_KINDS[\s\S]*['"]plan['"]/);
  });

  it('keeps active permission modes aligned with 05 target posture set', () => {
    const source = readProjectFile(join(ROOT, 'packages/shared/permission/mode-contracts.ts'));

    expect(source).toContain("export const ACTIVE_PERMISSION_MODES = ['default', 'accept_edits', 'plan', 'auto'] as const");
    expect(source).not.toContain("'bypass_permissions'");
    expect(source).not.toContain("'read_only'");
    expect(source).not.toContain("'execute'");
    expect(source).not.toContain("'review'");
  });

  it('does not keep old 04-stage guard assumptions after 05 tool foundation is active', () => {
    const currentArchitecture = [
      readProjectFile(join(ROOT, '.local-docs/architecture/agent-platform-module-architecture.md')),
      readProjectFile(join(ROOT, '.local-docs/specs/20-project-architecture-rebuild/02-agent-run-main-chain.md')),
    ].join('\n');

    expect(currentArchitecture).toContain('Tool Call');
    expect(currentArchitecture).toContain('Permission Policy');
    expect(currentArchitecture).toContain('ApprovalRequest');
  });

  it('keeps renderer run mode code behind typed preload and away from Host privileges', () => {
    const offenders = filesUnder('apps/desktop/src/renderer')
      .filter((file) => projectPath(file).includes('run-mode'))
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
    ].filter((file) => /run-mode|run-mode|plan|plan\.handler/.test(projectPath(file)));

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

  it('does not keep run-mode compatibility shims in production code', () => {
    const forbiddenPaths = [
      'packages/shared/run-mode-contracts.ts',
      'packages/db/repos/run-mode.repo.ts',
      'packages/core/run-runtime/run-mode.ts',
      'apps/desktop/src/main/services/run-mode.service.ts',
      'apps/desktop/src/renderer/entities/run-mode/index.ts',
      'apps/desktop/src/renderer/entities/run-mode/store.ts',
    ];

    for (const relative of forbiddenPaths) {
      expect(existsSync(join(ROOT, relative)), `${relative} should be deleted`).toBe(false);
    }

    const forbiddenPatterns = [
      /@megumi\/shared\/run-mode-contracts/,
      /@megumi\/db\/repos\/run-mode\.repo/,
      /services\/run-mode\.service/,
      /\bRunMode(Service|Repository|Snapshot|State|Schema)?\b/,
      /\bmodeSnapshot(Ref)?\b/,
      /\bmode_snapshot(_ref|_id)?\b/,
      /\brun_mode_snapshots\b/,
    ];

    for (const file of productionSourceFiles()) {
      const relative = projectPath(file);
      const text = readProjectFile(file);
      for (const pattern of forbiddenPatterns) {
        expect(text, `${relative} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
