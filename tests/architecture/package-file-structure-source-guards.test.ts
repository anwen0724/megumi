// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const sourceExtensions = /\.(ts|tsx)$/;

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
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

    return sourceExtensions.test(entry) ? [relative] : [];
  });
}

function productionFiles(): string[] {
  return [
    ...filesUnder('packages'),
    ...filesUnder('apps/desktop/src'),
  ];
}

function offenders(paths: string[], forbidden: RegExp[]): string[] {
  const output: string[] = [];

  for (const path of paths) {
    const text = read(path);
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        output.push(`${path} matches ${pattern}`);
      }
    }
  }

  return output;
}

describe('package and file structure source guards', () => {
  it('keeps shared contracts in semantic domain directories', () => {
    expect(existsSync(join(repoRoot, 'packages/shared/runtime/events.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/tool/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/input/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/input/command-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/input/preprocessing-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/hook/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/skill/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/prompt-template/contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/session/agent-profile-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/shared/agent'))).toBe(false);

    expect(filesUnder('packages/shared').filter((path) => /packages\/shared\/[^/]+-contracts\.ts$/.test(path))).toEqual([]);
    expect(filesUnder('packages/shared').filter((path) => /packages\/shared\/runtime-[^/]+\.ts$/.test(path))).toEqual([]);
  });

  it('keeps production code off old flat shared import paths', () => {
    expect(offenders(productionFiles(), [
      /@megumi\/shared\/agent-contracts/,
      /@megumi\/shared\/artifact-contracts/,
      /@megumi\/shared\/chat-stream-event-factory/,
      /@megumi\/shared\/chat-stream-event-schemas/,
      /@megumi\/shared\/chat-stream-events/,
      /@megumi\/shared\/chat-stream-to-timeline-projection/,
      /@megumi\/shared\/context-budget-contracts/,
      /@megumi\/shared\/input-command-contracts/,
      /@megumi\/shared\/ipc-channels/,
      /@megumi\/shared\/ipc-contracts/,
      /@megumi\/shared\/ipc-errors/,
      /@megumi\/shared\/ipc-schemas/,
      /@megumi\/shared\/memory-contracts/,
      /@megumi\/shared\/model-contracts/,
      /@megumi\/shared\/model-input-context-contracts/,
      /@megumi\/shared\/model-step-contracts/,
      /@megumi\/shared\/permission-mode-contracts/,
      /@megumi\/shared\/permission-settings-contracts/,
      /@megumi\/shared\/permission-snapshot-contracts/,
      /@megumi\/shared\/project-contracts/,
      /@megumi\/shared\/provider-contracts/,
      /@megumi\/shared\/recovery-contracts/,
      /@megumi\/shared\/run-context-contracts/,
      /@megumi\/shared\/run-contracts/,
      /@megumi\/shared\/runtime-context/,
      /@megumi\/shared\/runtime-errors/,
      /@megumi\/shared\/runtime-event-factory/,
      /@megumi\/shared\/runtime-event-schemas/,
      /@megumi\/shared\/runtime-events/,
      /@megumi\/shared\/runtime-request/,
      /@megumi\/shared\/runtime-result/,
      /@megumi\/shared\/runtime-validation/,
      /@megumi\/shared\/session-active-path-contracts/,
      /@megumi\/shared\/session-compaction-contracts/,
      /@megumi\/shared\/session-context-contracts/,
      /@megumi\/shared\/session-run-contracts/,
      /@megumi\/shared\/timeline-message-block-schemas/,
      /@megumi\/shared\/timeline-message-blocks/,
      /@megumi\/shared\/tool-contracts/,
      /@megumi\/shared\/workspace-change-contracts/,
      /@megumi\/shared\/workspace-file-contracts/,
    ])).toEqual([]);
  });

  it('removes the temporary input command compatibility shim after input foundation migration', () => {
    expect(existsSync(join(repoRoot, 'packages/shared/input-command'))).toBe(false);
  });

  it('keeps agent loop runtime inside packages/coding-agent/run', () => {
    expect(existsSync(join(repoRoot, 'packages/agent'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/loop/agent-loop.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/model-call/model-call-runner.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/model-call/model-event-adapter.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/model-call/model-step-provider-adapter.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/events/runtime-event-factory.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/lifecycle/run-state-policy.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/turn/run-turn.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/persistence/connection.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/core'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/context-management'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/tools'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/memory'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/db'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/security'))).toBe(false);

    expect(offenders(productionFiles(), [
      /@megumi\/core\/run-runtime/,
      /@megumi\/core\/runtime-exception/,
      /@megumi\/core\/runtime-assert/,
    ])).toEqual([]);
  });

  it('keeps desktop main services grouped by host backend domain', () => {
    const flatServiceFiles = readdirSync(join(repoRoot, 'apps/desktop/src/main/services'))
      .filter((entry) => entry.endsWith('.service.ts'));

    expect(flatServiceFiles).toEqual([]);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/run/model-call/model-call-runner.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/tools/execution/tool-executors/read-file.executor.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/settings/app-settings.service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/security/secret-store.service.ts'))).toBe(false);
  });

  it('keeps tool observation shaping in the observations owner module', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/tools/observations/observation-shaper.ts');
    const compatibilityPath = join(repoRoot, 'packages/coding-agent/tools/observation-shaper.ts');

    expect(existsSync(ownerPath)).toBe(true);
    expect(readFileSync(compatibilityPath, 'utf8')).toContain("export * from './observations/observation-shaper'");
  });

  it('keeps tool input validation in the schemas owner module', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/tools/schemas/tool-input-validation.ts');
    const compatibilityPath = join(repoRoot, 'packages/coding-agent/tools/validation.ts');

    expect(existsSync(ownerPath)).toBe(true);
    expect(readFileSync(compatibilityPath, 'utf8')).toContain("export * from './schemas/tool-input-validation'");
  });

  it('keeps tool registry resolution in the registry owner module', () => {
    expect(existsSync(join(repoRoot, 'packages/coding-agent/tools/registry/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/tools/registry.ts'))).toBe(false);
  });

  it('keeps runtime event persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/runtime-event.repo.ts');
    const sessionRunPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts');

    expect(existsSync(ownerPath)).toBe(true);
    expect(readFileSync(sessionRunPath, 'utf8')).toContain('new RuntimeEventRepository');
    expect(readFileSync(sessionRunPath, 'utf8')).not.toContain('INSERT INTO runtime_events');
  });

  it('keeps run execution facts in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/run-execution-fact.repo.ts');
    const sessionRunSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'),
      'utf8',
    );

    expect(existsSync(ownerPath)).toBe(true);
    expect(sessionRunSource).toContain('new RunExecutionFactRepository');
    expect(sessionRunSource).not.toContain('INSERT INTO run_steps');
    expect(sessionRunSource).not.toContain('INSERT INTO run_actions');
    expect(sessionRunSource).not.toContain('INSERT INTO run_observations');
  });

  it('keeps model step persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/model-step.repo.ts');
    const sessionRunSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'),
      'utf8',
    );

    expect(existsSync(ownerPath)).toBe(true);
    expect(sessionRunSource).toContain('new ModelStepRepository');
    expect(sessionRunSource).not.toContain('INSERT INTO model_steps');
    expect(sessionRunSource).not.toContain('SELECT * FROM model_steps');
  });

  it('keeps session message persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-message.repo.ts');
    const sessionRunSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'),
      'utf8',
    );

    expect(existsSync(ownerPath)).toBe(true);
    expect(sessionRunSource).toContain('new SessionMessageRepository');
    expect(sessionRunSource).not.toContain('INSERT INTO session_messages');
    expect(sessionRunSource).not.toContain('SELECT * FROM session_messages');
  });

  it('keeps session records in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-record.repo.ts');
    const sessionRunSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'),
      'utf8',
    );

    expect(existsSync(ownerPath)).toBe(true);
    expect(sessionRunSource).toContain('new SessionRecordRepository');
    expect(sessionRunSource).not.toContain('INSERT INTO sessions');
    expect(sessionRunSource).not.toContain('SELECT * FROM sessions');
  });

  it('keeps run records in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/run-record.repo.ts');
    const sessionRunSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'),
      'utf8',
    );

    expect(existsSync(ownerPath)).toBe(true);
    expect(sessionRunSource).toContain('new RunRecordRepository');
    expect(sessionRunSource).not.toContain('INSERT INTO runs');
    expect(sessionRunSource).not.toContain('SELECT * FROM runs');
  });

  it('keeps session compaction persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-compaction.repo.ts');
    const sessionRunSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'),
      'utf8',
    );

    expect(existsSync(ownerPath)).toBe(true);
    expect(sessionRunSource).toContain('new SessionCompactionRepository');
    expect(sessionRunSource).not.toContain('INSERT INTO session_compactions');
    expect(sessionRunSource).not.toContain('SELECT * FROM session_compactions');
  });

  it('keeps session context active-path transactions in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-context.repo.ts');
    const sessionRunSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'),
      'utf8',
    );

    expect(existsSync(ownerPath)).toBe(true);
    expect(sessionRunSource).toContain('new SessionContextRepository');
    expect(sessionRunSource).not.toContain('INSERT INTO session_source_entries');
    expect(sessionRunSource).not.toContain('INSERT INTO session_active_leaves');
    expect(sessionRunSource).not.toContain('private insertSessionSourceEntry');
    expect(sessionRunSource).not.toContain('private upsertActiveLeaf');
    expect(sessionRunSource).not.toContain('private getActiveLeafSourceEntryId');
  });

  it('wires session compaction orchestration through the session context repository port', () => {
    const runContractSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/run-contract.ts'), 'utf8');
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );
    const normalizedAgentRunServiceSource = agentRunServiceSource.replaceAll('\r\n', '\n');

    expect(runContractSource).toContain('sessionCompactionRepository?: SessionCompactionOrchestratorRepository');
    expect(agentRunServiceSource).toContain('repository: options.sessionCompactionRepository');
    expect(normalizedAgentRunServiceSource).not.toContain('repository: this.repository,\n            modelStepProvider: options.modelStepProvider');
    expect(sessionRuntimeSource).toContain('sessionContextRepository: SessionContextRepository');
    expect(sessionRuntimeSource).toContain('sessionCompactionRepository: options.sessionContextRepository');
    expect(runtimeSource).toContain('sessionContextRepository: persistence.sessionContextRepository');
  });

  it('wires session context input through split repository ports', () => {
    const sessionContextInputSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/session/session-context-input.ts'),
      'utf8',
    );
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(sessionContextInputSource).toContain('messageRepository: SessionContextInputMessageRepository');
    expect(sessionContextInputSource).toContain('sessionCompactionRepository: SessionContextInputCompactionRepository');
    expect(sessionContextInputSource).not.toContain('repository: SessionContextInputRepository;');
    expect(sessionRuntimeSource).toContain('new SessionContextInputService');
    expect(sessionRuntimeSource).toContain('messageRepository: options.sessionMessageRepository');
    expect(sessionRuntimeSource).toContain('sessionCompactionRepository: options.sessionContextRepository');
    expect(runtimeSource).toContain('sessionMessageRepository: persistence.sessionMessageRepository');
  });

  it('wires session service through split repository ports', () => {
    const sessionServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/session/session-service.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(sessionServiceSource).not.toContain("SessionRunRepository");
    expect(sessionServiceSource).toContain('sessionRepository: SessionServiceSessionRepository');
    expect(sessionServiceSource).toContain('messageRepository: SessionServiceMessageRepository');
    expect(sessionServiceSource).toContain('runRepository: SessionServiceRunRepository');
    expect(sessionRuntimeSource).toContain('sessionRepository: options.sessionRecordRepository');
    expect(sessionRuntimeSource).toContain('messageRepository: options.sessionMessageRepository');
    expect(sessionRuntimeSource).toContain('runRepository: options.runRecordRepository');
    expect(runtimeSource).toContain('sessionRecordRepository: persistence.sessionRecordRepository');
    expect(runtimeSource).toContain('runRecordRepository: persistence.runRecordRepository');
  });

  it('wires session branch service through split repository ports', () => {
    const sessionBranchServiceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/session/session-branch-service.ts'),
      'utf8',
    );
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(sessionBranchServiceSource).not.toContain('SessionRunRepository');
    expect(sessionBranchServiceSource).toContain('sessionRepository: SessionBranchSessionRepository');
    expect(sessionBranchServiceSource).toContain('messageRepository: SessionBranchMessageRepository');
    expect(sessionBranchServiceSource).toContain('runtimeEventRepository: SessionBranchRuntimeEventRepository');
    expect(sessionRuntimeSource).toContain('sessionRepository: options.sessionRecordRepository');
    expect(sessionRuntimeSource).toContain('messageRepository: options.sessionMessageRepository');
    expect(sessionRuntimeSource).toContain('runtimeEventRepository: options.runtimeEventRepository');
    expect(runtimeSource).toContain('runtimeEventRepository: persistence.runtimeEventRepository');
  });

  it('wires recovery runtime through split repository ports', () => {
    const recoveryRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition', `compose-coding-agent-${'recovery'}-runtime.ts`),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(recoveryRuntimeSource).not.toContain('SessionRunRepository');
    expect(recoveryRuntimeSource).toContain('runRepository: RunRecordRepository');
    expect(recoveryRuntimeSource).toContain('sessionRepository: SessionRecordRepository');
    expect(recoveryRuntimeSource).toContain('runtimeEventRepository: RuntimeEventRepository');
    expect(runtimeSource).toContain('runRepository: persistence.runRecordRepository');
    expect(runtimeSource).toContain('sessionRepository: persistence.sessionRecordRepository');
    expect(runtimeSource).toContain('runtimeEventRepository: persistence.runtimeEventRepository');
  });
});
