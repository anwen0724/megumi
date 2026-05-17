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
      if (entry === 'node_modules' || entry === '.git' || entry === '.claude') {
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

describe('agent lifecycle foundation source guards', () => {
  it('keeps packages/shared platform-independent', () => {
    const offenders = filesUnder('packages/shared')
      .filter((file) => /agent-lifecycle|runtime-events|runtime-event-schemas|ipc-channels|ipc-schemas|ids/.test(projectPath(file)))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/core|@megumi\/desktop)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps packages/core run runtime free of Host privileges and concrete persistence', () => {
    const offenders = filesUnder('packages/core')
      .filter((file) => projectPath(file).includes('run-runtime'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/desktop|fs|node:fs|child_process|node:child_process)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps run runtime implementation under the run-runtime path', () => {
    const runRuntimeFiles = filesUnder('packages/core/run-runtime');
    expect(runRuntimeFiles.length).toBeGreaterThan(0);
    const activeAgentRuntimeFiles = filesUnder('packages/core/agent-runtime')
      .filter((file) => !readProjectFile(file).includes("from '../run-runtime/"));

    expect(activeAgentRuntimeFiles.map(projectPath)).toEqual([]);
  });

  it('keeps renderer lifecycle code behind typed preload and away from core or DB', () => {
    const offenders = filesUnder('apps/desktop/src/renderer')
      .filter((file) => projectPath(file).includes('agent-lifecycle'))
      .filter((file) => {
        const source = readProjectFile(file);
        return /from ['"](electron|@megumi\/core|@megumi\/db)/.test(source);
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not define plan as an AgentAction kind', () => {
    const contracts = readProjectFile(join(ROOT, 'packages/shared/session-run-contracts.ts'));

    expect(contracts).toContain("'emit_message'");
    expect(contracts).not.toMatch(/RUN_ACTION_KINDS[\s\S]*['"]plan['"]/);
  });

  it('does not introduce obsolete RuntimeError fields', () => {
    const obsoleteRuntimeErrorField = ['recover', 'able'].join('');
    const obsoleteRuntimeErrorFieldPattern = new RegExp(`\\b${obsoleteRuntimeErrorField}\\??\\s*:`);
    const runtimeErrorContractFiles = [
      join(ROOT, 'packages/shared/runtime-errors.ts'),
      join(ROOT, 'packages/shared/ipc-errors.ts'),
      join(ROOT, 'packages/core/runtime-exception.ts'),
    ];

    const offenders = runtimeErrorContractFiles
      .filter((file) => obsoleteRuntimeErrorFieldPattern.test(readProjectFile(file)))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('does not implement later Agent capabilities in lifecycle foundation files', () => {
    const lifecycleFiles = [
      ...filesUnder('packages/shared'),
      ...filesUnder('packages/core'),
      ...filesUnder('packages/db'),
      ...filesUnder('apps/desktop/src/main'),
      ...filesUnder('apps/desktop/src/renderer'),
    ].filter((file) => /agent-lifecycle|run-runtime|agent\.handler/.test(projectPath(file)));

    const forbiddenPatterns = [
      /workspace context packing/i,
      /selected files/i,
      /memory recall/i,
      /long-term memory/i,
      /artifact storage/i,
      /approval policy evaluator/i,
      /sandbox executor/i,
      /checkpoint restore/i,
      /multi-agent/i,
      /handoff/i,
      /parallel subagents/i,
    ];

    const offenders = lifecycleFiles
      .filter((file) => forbiddenPatterns.some((pattern) => pattern.test(readProjectFile(file))))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });
});
