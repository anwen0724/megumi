import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const recoveryProductionFiles = [
  'packages/shared/recovery/contracts.ts',
  'packages/core/agent-runtime/recovery-observation-mapper.ts',
  'apps/desktop/src/main/services/runtime/recovery.service.ts',
  'apps/desktop/src/main/ipc/handlers/recovery.handler.ts',
  'apps/desktop/src/renderer/entities/recovery/store.ts',
];

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function offenders(pattern: RegExp, files = recoveryProductionFiles): string[] {
  return files.filter((file) => pattern.test(read(file)));
}

describe('recovery foundation source guards', () => {
  it('does not implement concrete tool execution or process execution in recovery foundation', () => {
    expect(offenders(/\b(child_process|execFile|spawn|execSync|spawnSync|toolExecutor\.execute|executeTool)\b/)).toEqual([]);
  });

  it('does not implement file snapshot, patch storage, git workflow, or undo/revert foundation', () => {
    expect(offenders(/\b(fileSnapshot|snapshotFile|patchStorage|git\s+checkout|git\s+apply|undoRun|revertRun|forkFromCheckpoint)\b/i)).toEqual([]);
  });

  it('does not introduce graph runtime, background job queue, or multi-agent orchestration', () => {
    expect(offenders(/\b(StateGraph|LangGraph|workflowNode|backgroundJob|jobQueue|subagent|handoff|multiAgent)\b/)).toEqual([]);
  });

  it('does not implement generic artifact, memory, or observability in recovery foundation', () => {
    expect(offenders(/\b(genericArtifact|artifactStorage|memoryStore|vectorMemory|embedding|metricsCollector|evaluator)\b/)).toEqual([]);
  });

  it('does not expose sensitive raw runtime data in recovery production code', () => {
    expect(offenders(/\b(rawFullPrompt|rawRestrictedFileContent|rawProviderBody|plaintextSecret|rawStack|rawCause)\b/)).toEqual([]);
  });

  it('does not add recoverable to RuntimeError model', () => {
    const runtimeContractFiles = [
      'packages/shared/runtime/errors.ts',
      'packages/shared/ipc/errors.ts',
      'packages/core/agent-runtime/errors.ts',
    ];

    expect(offenders(/\brecoverable\b/, runtimeContractFiles)).toEqual([]);
  });

  it('keeps core recovery platform independent', () => {
    const coreRecovery = read('packages/core/agent-runtime/recovery-observation-mapper.ts');

    expect(coreRecovery).not.toMatch(/from ['"]electron['"]/);
    expect(coreRecovery).not.toMatch(/from ['"]node:fs['"]/);
    expect(coreRecovery).not.toMatch(/from ['"]@megumi\/db['"]/);
    expect(coreRecovery).not.toMatch(/from ['"].*apps\/desktop/);
  });
});
