// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function existing(paths: string[]): string[] {
  return paths.filter((path) => existsSync(join(repoRoot, path)));
}

function filesUnder(path: string): string[] {
  const absolute = join(repoRoot, path);
  if (!existsSync(absolute)) {
    return [];
  }

  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);
    const relative = child.slice(repoRoot.length + 1).replaceAll('\\', '/');
    if (statSync(child).isDirectory()) {
      return filesUnder(relative);
    }

    return /\.(ts|tsx)$/.test(entry) ? [relative] : [];
  });
}

describe('09 session run integration final source guards', () => {
  it('removes old chat and agent preload namespaces from active source', () => {
    const preload = source('apps/desktop/src/preload/api.ts');
    const globalTypes = source('apps/desktop/src/renderer/shared/types/global.d.ts');

    expect(preload).not.toMatch(/\bIPC_CHANNELS\.chat(?!Stream)\b/);
    expect(preload).not.toContain('IPC_CHANNELS.agent');
    expect(preload).not.toMatch(/\bchat:\s*\{/);
    expect(preload).not.toMatch(/\bagent:\s*\{/);
    expect(preload).toContain('IPC_CHANNELS.chatStream.event');
    expect(preload).toMatch(/\bchatStream:\s*\{/);
    expect(globalTypes).not.toContain('chat:');
    expect(globalTypes).not.toContain('agent:');
  });

  it('removes session.message.send renderer main chain and old runtime hook', () => {
    const hook = source('apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts');

    expect(hook).toContain('IPC_CHANNELS.session.message.send');
    expect(hook).toContain('window.megumi.session.message.send');
    expect(hook).not.toContain('IPC_CHANNELS.chat.start');
    expect(hook).not.toMatch(/\bwindow\.megumi\.chat(?!Stream)\b/);
    expect(hook).toContain('window.megumi.chatStream.onEvent');
    expect(existing([
      'apps/desktop/src/renderer/features/chat/hooks/use-runtime-chat.ts',
    ])).toEqual([]);
  });

  it('removes migration-only bridge files for old session run names', () => {
    expect(existing([
      'packages/shared/agent-lifecycle-contracts.ts',
      'packages/shared/agent-context-contracts.ts',
      'packages/shared/agent-run-mode-contracts.ts',
      'packages/shared/agent-recovery-contracts.ts',
      `packages/core/${'agent-runtime'}/run-agent-turn.ts`,
      'packages/core/run-runtime/types.ts',
      `packages/core/${'agent-runtime'}/events.ts`,
      'packages/db/repos/agent-lifecycle.repo.ts',
      'packages/db/repos/agent-context.repo.ts',
      'packages/db/repos/agent-run-mode.repo.ts',
      'packages/db/repos/agent-tool.repo.ts',
      'packages/db/repos/agent-recovery.repo.ts',
      'apps/desktop/src/main/ipc/handlers/agent.handler.ts',
      'apps/desktop/src/main/ipc/handlers/chat.handler.ts',
      'apps/desktop/src/main/ipc/handlers/agent-context.handler.ts',
      'apps/desktop/src/main/ipc/handlers/agent-plan.handler.ts',
      'apps/desktop/src/main/ipc/handlers/agent-tool.handler.ts',
      'apps/desktop/src/main/ipc/handlers/agent-recovery.handler.ts',
      'apps/desktop/src/main/ipc/handlers/agent-artifact.handler.ts',
      'apps/desktop/src/main/ipc/handlers/agent-memory.handler.ts',
      'apps/desktop/src/main/services/agent-lifecycle.service.ts',
      'apps/desktop/src/main/services/agent-context.service.ts',
      'apps/desktop/src/main/services/agent-run-mode.service.ts',
      'apps/desktop/src/main/services/agent-tool.service.ts',
      'apps/desktop/src/main/services/agent-recovery.service.ts',
      'apps/desktop/src/main/services/agent-artifact.service.ts',
      'apps/desktop/src/main/services/agent-memory.service.ts',
      'apps/desktop/src/main/services/ai-chat.service.ts',
      'apps/desktop/src/renderer/entities/agent-lifecycle/store.ts',
      'apps/desktop/src/renderer/entities/agent-recovery/store.ts',
    ])).toEqual([]);
  });

  it('keeps old generic chat and agent session-run names out of active source', () => {
    // Product agent role/config names, such as agent-contracts and AgentSwitcher,
    // are intentionally outside this generic session/run namespace guard.
    const files = [
      ...filesUnder('packages'),
      ...filesUnder('apps'),
      ...filesUnder('tests'),
    ].filter((path) => !path.includes('packages/shared/agent-contracts'))
      .filter((path) => !path.includes('packages/coding-agent/composition/'));

    const offenders = files.filter((path) => {
      const text = source(path);
      if (path === 'tests/architecture/session-run-integration-final-source-guards.test.ts') {
        return false;
      }
      return /window\.megumi\.chat(?!Stream)\b|window\.megumi\.agent|IPC_CHANNELS\.chat(?!Stream)\b|IPC_CHANNELS\.agent|useRuntimeChat|chat:start|chat\.start|agent_(sessions|runs|steps|actions|observations|context|run_mode|checkpoints|resume|cancel|retry)|apps\/desktop\/src\/main\/(services|ipc\/handlers)\/agent-|agent-(lifecycle|context|run-mode|recovery)|agent[.:](session|run|context|plan|tool|approval|recovery|artifact|artifacts|memory)/.test(text);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps runtime foundation semantics intact', () => {
    const runtimeEvents = source('packages/shared/runtime/events.ts');
    const runtimeErrors = source('packages/shared/runtime/errors.ts');
    const ipcContracts = source('packages/shared/ipc/contracts.ts');

    expect(runtimeEvents).toContain('eventType');
    expect(runtimeEvents).not.toMatch(/\btype:\s*RuntimeEventType\b/);
    expect(runtimeErrors).toContain('retryable');
    expect(runtimeErrors).toContain('severity');
    expect(runtimeErrors).not.toContain('recoverable');
    expect(ipcContracts).toContain('meta:');
    expect(ipcContracts).toContain('channel');
    expect(ipcContracts).not.toMatch(/\boperationName\b.*RuntimeIpcRequestMeta/);
  });

  it('routes session-run model input construction through ModelStepInputBuildService', () => {
    const sessionRun = source('packages/coding-agent/run/session-run-service.ts');

    expect(sessionRun).toContain('ModelStepInputBuildService');
    expect(sessionRun).toContain('modelStepInputBuildService');
    expect(sessionRun).toContain('modelInputRuntimeSourceOverrides');
    expect(sessionRun).not.toContain('buildModelStepInputContextFromSources');
    expect(sessionRun).not.toContain('createModelStepInputContextId');
    expect(sessionRun).not.toContain('loadInstructionSourcesForModelStep');
    expect(sessionRun).not.toContain("contextKind: 'preflight'");
    expect(sessionRun).not.toContain('initial_model_step_preflight');
  });

  it('keeps formal context build source free of old preflight naming', () => {
    const scannedFiles = [
      'packages/coding-agent/run/context/compaction/session-compaction.ts',
      'packages/coding-agent/run/session-run-service.ts',
      'packages/coding-agent/run/context/compaction/session-compaction-orchestrator.ts',
    ];
    const offenders = scannedFiles.filter((path) => /\bpreflight\b/i.test(source(path)));

    expect(offenders).toEqual([]);
  });
});
