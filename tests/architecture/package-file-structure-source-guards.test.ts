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

  it('keeps agent loop runtime inside packages/coding-agent while state and events are top-level owners', () => {
    expect(existsSync(join(repoRoot, 'packages/agent'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/loop/agent-loop.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-call/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-call/model-call-runner.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-call/model-event-adapter.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-call/model-step-provider-adapter.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/tool-call-contract.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/approval/pending-approval-registry.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/model-call/model-call-runner.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/tool-calls/tool-call-runner.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/events/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-factory.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-log.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-metadata.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-publisher.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-utils.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/state/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/state/run-state-policy.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/state/run-approval-resume.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/state/run-terminal-coordinator.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/model-call-input-builder.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/model-call-context.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/model-input-context-builder.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/parts/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/compaction/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/instructions/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/resources/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation-port.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/session/session-messages.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/input/preprocessing/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/input/preprocessing/session-message-input-preprocessing.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/context'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/runtime-input.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/events/runtime-event-factory.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/lifecycle/run-state-policy.ts'))).toBe(false);
    expect(readFileSync(join(repoRoot, 'packages/coding-agent/context/model-call-input-builder.ts'), 'utf8'))
      .toContain('export class ModelCallInputBuildService');
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/run-contract.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/turn/run-turn.ts'))).toBe(false);
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
    expect(existsSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-call/model-call-runner.ts'))).toBe(true);
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

    expect(existsSync(ownerPath)).toBe(true);
    expect(readFileSync(ownerPath, 'utf8')).toContain('INSERT INTO runtime_events');
    expect(existsSync(join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'))).toBe(false);
  });

  it('keeps run execution facts in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/run-execution-fact.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO run_steps');
    expect(ownerSource).toContain('INSERT INTO run_actions');
    expect(ownerSource).toContain('INSERT INTO run_observations');
  });

  it('keeps model step persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/model-step.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO model_steps');
    expect(ownerSource).toContain('SELECT * FROM model_steps');
  });

  it('keeps session message persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-message.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO session_messages');
    expect(ownerSource).toContain('SELECT * FROM session_messages');
  });

  it('keeps session records in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-record.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO sessions');
    expect(ownerSource).toContain('SELECT * FROM sessions');
  });

  it('keeps run records in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/run-record.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO runs');
    expect(ownerSource).toContain('SELECT * FROM runs');
  });

  it('keeps session compaction persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-compaction.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO session_compactions');
    expect(ownerSource).toContain('SELECT * FROM session_compactions');
  });

  it('keeps session context active-path transactions in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/session-context.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('new SessionActivePathRepository');
    expect(ownerSource).toContain('new SessionCompactionRepository');
    expect(ownerSource).toContain('this.database.transaction');
  });

  it('wires session compaction orchestration through the session context repository port', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );
    const normalizedAgentLoopOperationSource = agentLoopOperationSource.replaceAll('\r\n', '\n');

    expect(agentLoopOperationSource).toContain('sessionCompactionRepository?: SessionCompactionOrchestratorRepository');
    expect(agentLoopOperationSource).toContain('repository: options.sessionCompactionRepository');
    expect(normalizedAgentLoopOperationSource).not.toContain('repository: this.repository,\n            modelCallProvider: options.modelCallProvider');
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

  it('wires tool runtime through the run record port', () => {
    const toolRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-tool-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(toolRuntimeSource).not.toContain('SessionRunRepository');
    expect(toolRuntimeSource).toContain('runRepository: RunRecordRepository');
    expect(toolRuntimeSource).toContain('input.runRepository.getRun(runId)');
    expect(runtimeSource).toContain('runRepository: persistence.runRecordRepository');
  });

  it('keeps run service contracts off the concrete session-run repository type', () => {
    const persistencePortsSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/agent-run-repository-ports.ts'),
      'utf8',
    );
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const productRuntimeIndexSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/product-runtime/index.ts'),
      'utf8',
    );
    const retryCoordinatorSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/state/run-retry-coordinator.ts'),
      'utf8',
    );

    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/run-contract.ts'))).toBe(false);
    expect(agentLoopOperationSource).not.toContain('SessionRunRepository');
    expect(retryCoordinatorSource).not.toContain('SessionRunRepository');
    expect(persistencePortsSource).toContain('export interface AgentRunSessionRepositoryPort');
    expect(persistencePortsSource).toContain('export interface AgentRunRunRecordRepositoryPort');
    expect(persistencePortsSource).toContain('export interface AgentRunExecutionFactRepositoryPort');
    expect(persistencePortsSource).toContain('export interface AgentRunModelStepRepositoryPort');
    expect(persistencePortsSource).toContain('export interface AgentRunRuntimeEventRepositoryPort');
    expect(retryCoordinatorSource).toContain('export interface RunRetryCoordinatorRepositoryPort');
    expect(productRuntimeIndexSource).toContain("export * from './agent-loop-operation'");
    expect(productRuntimeIndexSource).not.toContain("export * from '../state'");
  });

  it('keeps AgentLoopOperation options on owner-named repository ports', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');

    expect(agentLoopOperationSource).not.toContain('repository: AgentRunRepositoryPort;');
    expect(agentLoopOperationSource).toContain('sessionRepository: AgentRunSessionRepositoryPort;');
    expect(agentLoopOperationSource).toContain('messageRepository: AgentRunMessageRepositoryPort;');
    expect(agentLoopOperationSource).toContain('runRecordRepository: AgentRunRunRecordRepositoryPort;');
    expect(agentLoopOperationSource).toContain('runExecutionFactRepository: AgentRunExecutionFactRepositoryPort;');
    expect(agentLoopOperationSource).toContain('modelStepRepository: AgentRunModelStepRepositoryPort;');
    expect(agentLoopOperationSource).toContain('sessionContextRepository: AgentRunSessionContextRepositoryPort;');
    expect(agentLoopOperationSource).toContain('runtimeEventRepository: AgentRunRuntimeEventRepositoryPort;');
    expect(agentLoopOperationSource).not.toContain('const repository = options.repository');
  });

  it('keeps model-call and tool runtime contracts in the agent-loop owner', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const modelCallContractSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/model-call/model-call-contract.ts'),
      'utf8',
    );
    const toolCallContractSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/tool-call-contract.ts'),
      'utf8',
    );

    expect(agentLoopOperationSource).not.toContain('export interface AgentRunModelStepProvider');
    expect(agentLoopOperationSource).not.toContain('export type AgentRunModelCallProvider');
    expect(agentLoopOperationSource).not.toContain('export interface AgentRunToolRuntimeFactory');
    expect(modelCallContractSource).toContain('export interface ModelCallProvider');
    expect(toolCallContractSource).toContain('export interface ToolRuntimeFactory');
  });

  it('keeps AgentLoopOperation coordinator repository adapters in composition', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const repositoryOptionsSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/agent-loop-operation-repository-options.ts'),
      'utf8',
    );

    expect(agentLoopOperationSource).not.toContain('private readonly runCompletionRepository');
    expect(agentLoopOperationSource).not.toContain('private readonly runTerminalRepository');
    expect(agentLoopOperationSource).not.toContain('private readonly runRetryRepository');
    expect(agentLoopOperationSource).not.toContain('this.runCompletionRepository = options.runCompletionRepository');
    expect(agentLoopOperationSource).not.toContain('this.runTerminalRepository = options.runTerminalRepository');
    expect(agentLoopOperationSource).not.toContain('this.runRetryRepository = options.runRetryRepository');
    expect(agentLoopOperationSource).not.toContain('this.runCompletionRepository = {');
    expect(agentLoopOperationSource).not.toContain('this.runTerminalRepository = {');
    expect(agentLoopOperationSource).not.toContain('this.runRetryRepository = {');
    expect(repositoryOptionsSource).toContain('postRunHooksRepository');
    expect(repositoryOptionsSource).toContain('runTerminalRepository');
    expect(repositoryOptionsSource).toContain('runRetryRepository');
  });

  it('keeps AgentLoopOperation coordinator construction in composition', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const defaultAgentLoopOperationSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/create-default-agent-loop-operation.ts'),
      'utf8',
    );
    const postRunHooksSource = readFileSync(join(repoRoot, 'packages/coding-agent/hooks/post-run-hooks.ts'), 'utf8');
    const runTerminalCoordinatorSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/state/run-terminal-coordinator.ts'),
      'utf8',
    );
    const runRetryCoordinatorSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/state/run-retry-coordinator.ts'),
      'utf8',
    );
    const workspaceChangeReadSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/workspace/workspace-change-read.ts'),
      'utf8',
    );
    const workspaceIndexSource = readFileSync(join(repoRoot, 'packages/coding-agent/workspace/index.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');
    const toolRegistrySnapshotSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/tools/tool-registry-snapshot.ts'),
      'utf8',
    );
    const runContextServiceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/context/resources/run-context-service.ts'),
      'utf8',
    );
    const agentInstructionSourceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/context/instructions/agent-instruction-source.ts'),
      'utf8',
    );
    const modelCallInputBuilderSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/context/model-call-input-builder.ts'),
      'utf8',
    );
    const modelInputSourceOverridesSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/context/model-input-source-overrides.ts'),
      'utf8',
    );
    const contextIndexSource = readFileSync(join(repoRoot, 'packages/coding-agent/context/index.ts'), 'utf8');
    const sessionContextInputSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/session/session-context-input.ts'),
      'utf8',
    );
    const memoryRecallRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/memory/memory-recall-runtime.ts'),
      'utf8',
    );
    const memoryCaptureRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/memory/memory-runtime-capture.ts'),
      'utf8',
    );
    const memoryRuntimePortsSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/memory/memory-runtime-ports.ts'),
      'utf8',
    );
    const productSettingsSource = readFileSync(join(repoRoot, 'packages/coding-agent/settings/product-settings.ts'), 'utf8');
    const sessionServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/session/session-service.ts'), 'utf8');

    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/run-contract.ts'))).toBe(false);
    expect(agentLoopOperationSource).not.toContain('export interface AgentRunPostRunHooksPort');
    expect(agentLoopOperationSource).not.toContain('export interface AgentRunTerminalCoordinatorPort');
    expect(agentLoopOperationSource).not.toContain('export interface AgentRunRetryCoordinatorPort');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunWorkspaceChangeReadPort');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunToolDefinitionProvider');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunProviderCapabilitySummaryProvider');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunToolRegistrySnapshotService');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunContextService');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunAgentInstructionSourceService');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunSessionContextInputService');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunModelCallInputBuildService');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunGlobalInstructionDirectoryProvider');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunSessionInstructionSourceProvider');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunEffectiveCwdProvider');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunMemoryRecallService');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunMemoryCaptureService');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunMemorySettingsProvider');
    expect(agentLoopOperationSource).not.toContain('export interface SessionRunMemoryMarkdownSyncService');
    expect(agentLoopOperationSource).not.toContain('export interface AgentLoopOperationHomePaths');
    expect(sessionServiceSource).not.toContain('export interface SessionMemorySettingsProvider');
    expect(sessionServiceSource).not.toContain('export interface SessionMemoryMarkdownSyncService');
    expect(agentLoopOperationSource).toContain('postRunHooks: PostRunHooksPort;');
    expect(agentLoopOperationSource).toContain('runTerminalCoordinator: RunTerminalCoordinatorPort;');
    expect(agentLoopOperationSource).toContain('runRetryCoordinator: RunRetryCoordinatorPort;');
    expect(agentLoopOperationSource).toContain('workspaceChanges?: WorkspaceChangeReadPort;');
    expect(agentLoopOperationSource).toContain('toolDefinitionProvider?: ToolSetRegistryProvider;');
    expect(agentLoopOperationSource).toContain('providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;');
    expect(agentLoopOperationSource).toContain('toolRegistrySnapshotService?: ToolRegistrySnapshotServicePort;');
    expect(agentLoopOperationSource).toContain('contextService?: RunBaselineContextPort;');
    expect(agentLoopOperationSource).toContain('agentInstructionSourceService?: AgentInstructionSourcePort;');
    expect(agentLoopOperationSource).toContain('modelCallInputBuildService?: ModelCallInputBuildPort;');
    expect(agentLoopOperationSource).toContain('modelInputSourceOverrideProvider?: AgentLoopInitialModelInputSourceOverrideProvider;');
    expect(agentLoopOperationSource).toContain('sessionContextInputService?: SessionContextInputBuildPort;');
    expect(agentLoopOperationSource).toContain('memoryRecallService?: MemoryRecallPort;');
    expect(agentLoopOperationSource).not.toContain('memoryCaptureService?:');
    expect(agentLoopOperationSource).toContain('memorySettingsProvider?: MemorySettingsPort;');
    expect(agentLoopOperationSource).toContain('memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;');
    expect(postRunHooksSource).toContain('export interface PostRunHooksPort');
    expect(runTerminalCoordinatorSource).toContain('export interface RunTerminalCoordinatorPort');
    expect(runRetryCoordinatorSource).toContain('export interface RunRetryCoordinatorPort');
    expect(workspaceChangeReadSource).toContain('export interface WorkspaceChangeReadPort');
    expect(workspaceIndexSource).toContain("export * from './workspace-change-read';");
    expect(agentLoopSource).toContain('export interface ToolSetRegistryProvider');
    expect(agentLoopSource).toContain('export interface ToolSetCapabilityProvider');
    expect(toolRegistrySnapshotSource).toContain('export interface ToolRegistrySnapshotServicePort');
    expect(runContextServiceSource).toContain('export interface RunBaselineContextPort');
    expect(agentInstructionSourceSource).toContain('export interface AgentInstructionSourcePort');
    expect(modelCallInputBuilderSource).toContain('export interface ModelCallInputBuildPort');
    expect(modelInputSourceOverridesSource).toContain('export class ModelInputSourceOverrideService');
    expect(modelInputSourceOverridesSource).toContain('export interface ModelInputGlobalInstructionDirectoryProvider');
    expect(modelInputSourceOverridesSource).toContain('export interface ModelInputSessionInstructionSourceProvider');
    expect(modelInputSourceOverridesSource).toContain('export interface ModelInputEffectiveCwdProvider');
    expect(contextIndexSource).toContain("export * from './model-input-source-overrides';");
    expect(sessionContextInputSource).toContain('export interface SessionContextInputBuildPort');
    expect(memoryRecallRuntimeSource).toContain('export interface MemoryRecallPort');
    expect(memoryCaptureRuntimeSource).toContain('export interface MemoryCapturePort');
    expect(memoryRuntimePortsSource).toContain('export interface MemoryProjectMirrorSyncPort');
    expect(productSettingsSource).toContain('export interface MemorySettingsPort');
    expect(agentLoopOperationSource).not.toContain('new RunCompletionHooksCoordinator');
    expect(agentLoopOperationSource).not.toContain('new PostRunHooksCoordinator');
    expect(agentLoopOperationSource).not.toContain('new RunTerminalCoordinator');
    expect(agentLoopOperationSource).not.toContain('new RunRetryCoordinator');
    expect(agentLoopOperationSource).toContain('this.postRunHooks = options.postRunHooks');
    expect(agentLoopOperationSource).not.toContain('private readonly runTerminalCoordinator');
    expect(agentLoopOperationSource).not.toContain('private readonly runRetryCoordinator');
    expect(agentLoopOperationSource).toContain('terminalCoordinator: options.runTerminalCoordinator');
    expect(agentLoopOperationSource).toContain('retryCoordinator: options.runRetryCoordinator');
    expect(sessionRuntimeSource).toContain("from '../hooks'");
    expect(sessionRuntimeSource).toContain("from '../state'");
    expect(sessionRuntimeSource).toContain('new PostRunHooksCoordinator');
    expect(sessionRuntimeSource).toContain('new RunTerminalCoordinator');
    expect(sessionRuntimeSource).toContain('new RunRetryCoordinator');
    expect(defaultAgentLoopOperationSource).toContain("from '../hooks'");
    expect(defaultAgentLoopOperationSource).toContain("from '../state'");
    expect(defaultAgentLoopOperationSource).toContain('export interface CreateDefaultAgentLoopOperationHomePaths');
    expect(defaultAgentLoopOperationSource).toContain('new PostRunHooksCoordinator');
    expect(defaultAgentLoopOperationSource).toContain('new RunTerminalCoordinator');
    expect(defaultAgentLoopOperationSource).toContain('new RunRetryCoordinator');
  });

  it('keeps retry lifecycle ownership in the top-level state module', () => {
    const stateRetryPath = join(repoRoot, 'packages/coding-agent/state/run-retry-coordinator.ts');
    const runRetryPath = join(repoRoot, 'packages/coding-agent/obsolete-run/lifecycle/run-retry-coordinator.ts');
    const stateLifecycleIndex = readFileSync(join(repoRoot, 'packages/coding-agent/state/lifecycle/index.ts'), 'utf8');
    const stateIndex = readFileSync(join(repoRoot, 'packages/coding-agent/state/index.ts'), 'utf8');

    expect(existsSync(stateRetryPath)).toBe(true);
    expect(existsSync(runRetryPath)).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/lifecycle'))).toBe(false);
    expect(stateLifecycleIndex).toContain("export * from './run-lifecycle';");
    expect(stateLifecycleIndex).toContain("export * from './run-types';");
    expect(stateIndex).toContain("export * from './run-retry-coordinator';");
    expect(stateIndex).toContain("export * from './lifecycle';");
  });

  it('keeps approval resume event shaping in the approval submodule', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const approvalResumeEventsPath = join(
      repoRoot,
      'packages/coding-agent/agent-loop/tool-call/approval/approval-resume-events.ts',
    );

    expect(existsSync(approvalResumeEventsPath)).toBe(true);
    const approvalResumeEventsSource = readFileSync(approvalResumeEventsPath, 'utf8');
    expect(agentLoopOperationSource).not.toContain('private persistResumeRuntimeEvents');
    expect(agentLoopOperationSource).not.toContain('private createToolResultRuntimeEvent');
    expect(agentLoopOperationSource).not.toContain('function createToolResultSummary');
    expect(agentLoopOperationSource).not.toContain("eventType: 'approval.resolved'");
    expect(agentLoopOperationSource).not.toContain('resumeEvents.toolResultIdsWithEvents');
    expect(agentLoopOperationSource).not.toContain('for (const toolResult of toolResults)');
    expect(approvalResumeEventsSource).toContain('export function persistResumeRuntimeEvents');
    expect(approvalResumeEventsSource).toContain('export function createToolResultRuntimeEvent');
    expect(approvalResumeEventsSource).toContain('export function createApprovalResolvedRuntimeEvent');
    expect(approvalResumeEventsSource).toContain('export function collectApprovalResumeRuntimeEvents');
  });

  it('keeps approval resume registry mutation in the approval submodule', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const pendingApprovalRegistrySource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/approval/pending-approval-registry.ts'),
      'utf8',
    );
    const approvalResumeGroupSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/approval/approval-resume-group.ts'),
      'utf8',
    );

    expect(agentLoopOperationSource).not.toContain('approvalResume.pendingByApprovalId.delete(input.approvalRequestId)');
    expect(agentLoopOperationSource).not.toContain('this.pendingApprovalRegistry.deleteApproval(input.approvalRequestId)');
    expect(agentLoopOperationSource).not.toContain('approvalResume.resolvedResults.push(...toolResults)');
    expect(agentLoopOperationSource).not.toContain('this.pendingApprovalRegistry.deleteGroup(approvalResume.groupId)');
    expect(agentLoopOperationSource).not.toContain('const group: AgentRunApprovalResumeGroup');
    expect(agentLoopOperationSource).not.toContain('pendingByApprovalId: new Map(input.pendingApprovalResumes');
    expect(agentLoopOperationSource).not.toContain('waitForAgentLoopApproval({');
    expect(pendingApprovalRegistrySource).toContain('export function resolvePendingApproval');
    expect(pendingApprovalRegistrySource).toContain('export function closePendingApprovalGroup');
    expect(approvalResumeGroupSource).toContain('export function registerApprovalResumeGroup');
    expect(approvalResumeGroupSource).toContain('waitForAgentLoopApproval');
  });

  it('keeps tool result model input emission ownership in the model-input submodule', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const agentLoopOperationToolRepositoryAdapterSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/agent-loop-operation-tool-repository-adapter.ts'),
      'utf8',
    );
    const composeCodingAgentToolRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-tool-runtime.ts'),
      'utf8',
    );
    const toolResultModelInputEmittedPath = join(
      repoRoot,
      'packages/coding-agent/agent-loop/tool-call/model-input/tool-result-model-input-emitted.ts',
    );

    expect(existsSync(toolResultModelInputEmittedPath)).toBe(true);
    const toolResultModelInputEmittedSource = readFileSync(toolResultModelInputEmittedPath, 'utf8');
    expect(agentLoopOperationToolRepositoryAdapterSource).toContain('markToolResultsSubmittedToModelInput');
    expect(composeCodingAgentToolRuntimeSource).toContain('markToolResultsSubmittedToModelInput');
    expect(toolResultModelInputEmittedSource).toContain('export function markToolResultsSubmittedToModelInput');
    expect(toolResultModelInputEmittedSource).toContain('createToolResultsSubmittedToModelInputEvent');
  });

  it('keeps approval resume model input preparation in the approval submodule', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const approvalResumeModelInputPath = join(
      repoRoot,
      'packages/coding-agent/agent-loop/tool-call/approval/approval-resume-model-input.ts',
    );

    expect(existsSync(approvalResumeModelInputPath)).toBe(true);
    const approvalResumeModelInputSource = readFileSync(approvalResumeModelInputPath, 'utf8');
    expect(agentLoopOperationSource).not.toContain("contextKind: 'approval-resume'");
    expect(agentLoopOperationSource).not.toContain('pending.accumulatedToolResults');
    expect(agentLoopOperationSource).not.toContain('pending.accumulatedProviderStates');
    expect(approvalResumeModelInputSource).toContain('export async function prepareApprovalResumeModelInput');
  });

  it('keeps approval resume internals behind ToolCallRunner public capabilities', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');
    const toolCallsIndexSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/index.ts'), 'utf8');
    const toolCallRunnerSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts'),
      'utf8',
    );

    expect(toolCallsIndexSource).not.toContain("export * from './approval/");
    expect(toolCallsIndexSource).not.toContain("export * from './model-input/");
    expect(agentLoopOperationSource).not.toContain('closePendingApprovalGroup,');
    expect(agentLoopOperationSource).not.toContain('collectApprovalResumeRuntimeEvents,');
    expect(agentLoopOperationSource).not.toContain('createApprovalResolvedRuntimeEvent,');
    expect(agentLoopOperationSource).not.toContain('prepareApprovalResumeModelInput,');
    expect(agentLoopOperationSource).not.toContain('resolvePendingApproval,');
    expect(agentLoopOperationSource).not.toContain('approvalResume.toolRuntime.resumeToolApproval(input)');
    expect(agentLoopOperationSource).not.toContain('approvalResume.toolRuntime.createApprovalResolvedRuntimeEvent');
    expect(agentLoopOperationSource).not.toContain('approvalResume.toolRuntime.prepareApprovalResumeModelInput');
    expect(agentLoopSource).toContain('approvalResume.toolRuntime.resumeToolApproval');
    expect(agentLoopSource).toContain('approvalResume.toolRuntime.createApprovalResolvedRuntimeEvent');
    expect(agentLoopSource).toContain('approvalResume.toolRuntime.prepareApprovalResumeModelInput');
    expect(toolCallRunnerSource).toContain('createApprovalResolvedRuntimeEvent');
    expect(toolCallRunnerSource).toContain('prepareApprovalResumeModelInput');
    expect(toolCallRunnerSource).toContain('markToolResultsSubmittedToModelInput');
  });

  it('keeps approval resume model loop wiring in the top-level agent-loop owner', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');

    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/loop'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/turn'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/approval-resume-model-loop.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-tool-loop-stream.ts'))).toBe(false);
    expect(agentLoopOperationSource).not.toContain('const resumedRequest: ModelStepRuntimeRequest');
    expect(agentLoopOperationSource).not.toContain('const resumedModelEvents = streamCodingAgentModelToolLoop({');
    expect(agentLoopOperationSource).not.toContain('approvalResume.toolRuntime.resolvePendingApproval');
    expect(agentLoopOperationSource).not.toContain('approvalResume.toolRuntime.closePendingApprovalGroup');
    expect(agentLoopOperationSource).not.toContain('approvalResume.toolRuntime.collectApprovalResumeRuntimeEvents');
    expect(agentLoopOperationSource).not.toContain('approvalResume.toolRuntime.prepareApprovalResumeModelInput');
    expect(agentLoopOperationSource).not.toContain('approvalResume.toolRuntime.markToolResultsSubmittedToModelInput');
    expect(agentLoopOperationSource).toContain("from '../agent-loop'");
    expect(agentLoopOperationSource).toContain('resumeToolApprovalAgentLoop({');
    expect(agentLoopSource).toContain('export function streamApprovalResumeModelLoop');
    expect(agentLoopSource).toContain('export async function* resumeToolApprovalAgentLoop');
    expect(agentLoopSource).toContain('export async function* streamCodingAgentModelToolLoop');
  });

  it('keeps model-call event recording in the top-level agent-loop owner', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');

    expect(agentLoopOperationSource).not.toContain('private async *persistModelCallEvents');
    expect(agentLoopOperationSource).not.toContain('assistantContent += getAssistantDeltaContent');
    expect(agentLoopOperationSource).not.toContain('this.sessionMessageService.commitAssistantReply({');
    expect(agentLoopOperationSource).not.toContain('this.postRunHooks.scheduleRunCompletedMemoryCapture({');
    expect(agentLoopOperationSource).toContain('createAgentLoopEventRecorder<');
    expect(agentLoopSource).toContain('export function createAgentLoopEventRecorder');
    expect(agentLoopSource).toContain('registerApprovalResumeGroup({');
    expect(agentLoopSource).toContain('completeAgentLoopModelCall({');
  });

  it('keeps approval resume run status restoration in top-level state owner', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const approvalResumeStatePath = join(
      repoRoot,
      'packages/coding-agent/state/run-approval-resume.ts',
    );

    expect(existsSync(approvalResumeStatePath)).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/lifecycle/run-approval-resume.ts'))).toBe(false);
    const approvalResumeStateSource = readFileSync(approvalResumeStatePath, 'utf8');
    expect(agentLoopOperationSource).not.toContain("assertRunStatusTransition(persistedRun.status, 'running')");
    expect(agentLoopOperationSource).not.toContain("from: 'waiting_for_approval',\n      to: 'running'");
    expect(approvalResumeStateSource).toContain('export function resumeRunAfterApproval');
    expect(approvalResumeStateSource).toContain("from: 'waiting_for_approval'");
    expect(approvalResumeStateSource).toContain("to: 'running'");
  });

  it('keeps AgentLoopOperation internals on owner-named repository ports', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const submitInputOperationSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/product-runtime/submit-input-operation.ts'),
      'utf8',
    );

    expect(agentLoopOperationSource).not.toContain('private readonly repository: AgentRunRepositoryPort');
    expect(agentLoopOperationSource).not.toContain('this.repository = options.repository');
    expect(agentLoopOperationSource).toContain('private readonly sessionRepository: AgentRunSessionRepositoryPort');
    expect(agentLoopOperationSource).toContain('private readonly runRecordRepository: AgentRunRunRecordRepositoryPort');
    expect(agentLoopOperationSource).toContain('private readonly runtimeEventRepository: AgentRunRuntimeEventRepositoryPort');
    expect(agentLoopOperationSource).toContain('private readonly sessionMessageService: SessionMessageService');
    expect(agentLoopOperationSource).toContain('sessionRepository: this.sessionRepository');
    expect(agentLoopOperationSource).not.toContain('private resolveSessionForMessage');
    expect(agentLoopOperationSource).not.toContain('private appendSourceAndMoveLeaf');
    expect(agentLoopOperationSource).not.toContain('private assertActiveBranchDraftMarker');
    expect(agentLoopOperationSource).not.toContain('private recordManualRerunAttemptForBranchDraft');
    expect(agentLoopOperationSource).not.toContain('function sessionMessageSourceRef');
    expect(agentLoopOperationSource).not.toContain('function sessionRunSourceRef');
    expect(agentLoopOperationSource).not.toContain('assertActiveBranchDraftMarker as assertSessionActiveBranchDraftMarker');
    expect(agentLoopOperationSource).not.toContain('activePathRepository: this.requireActivePathRepository()');
    expect(agentLoopOperationSource).not.toContain('requireSessionBranchService');
    expect(submitInputOperationSource).toContain('this.sessionBranchService.assertActiveBranchDraftMarker');
    expect(submitInputOperationSource).toContain('this.runRetryCoordinator.recordManualRerunAttemptForBranchDraft');
    expect(agentLoopOperationSource).not.toContain('repository: this.runTerminalRepository');
    expect(agentLoopOperationSource).not.toContain('repository: this.runRetryRepository');
    expect(agentLoopOperationSource).not.toContain('repository: this.runCompletionRepository');
  });

  it('keeps submit input product operation out of the transitional AgentLoopOperation facade', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const submitInputOperationSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/product-runtime/submit-input-operation.ts'),
      'utf8',
    );

    expect(agentLoopOperationSource).toContain('this.submitInputOperation.send(input)');
    expect(agentLoopOperationSource).not.toContain('prepareSessionMessageInput({');
    expect(agentLoopOperationSource).not.toContain('parseSessionMessageRawInput({');
    expect(agentLoopOperationSource).not.toContain('this.sessionMessageService.prepareUserMessage({');
    expect(agentLoopOperationSource).not.toContain('createSessionMessageChatStreamAdapter({');
    expect(agentLoopOperationSource).not.toContain('this.activeSessionMessageRuns.register(input.requestId');
    expect(submitInputOperationSource).toContain('export class SubmitInputOperation');
    expect(submitInputOperationSource).toContain('prepareSessionMessageInput({');
    expect(submitInputOperationSource).toContain('createRunPermissionSnapshot({');
    expect(submitInputOperationSource).toContain('createSessionMessageChatStreamAdapter({');
    expect(submitInputOperationSource).toContain('startAgentLoopRun({');
  });

  it('keeps session run control product operation out of the transitional AgentLoopOperation facade', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const sessionRunControlOperationSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/product-runtime/session-run-control-operation.ts'),
      'utf8',
    );

    expect(agentLoopOperationSource).toContain('this.sessionRunControlOperation.cancelSessionMessage(payload)');
    expect(agentLoopOperationSource).toContain('this.sessionRunControlOperation.createManualRetryFromRun(input)');
    expect(agentLoopOperationSource).toContain('this.sessionRunControlOperation.createManualRerunFromUserMessage(input)');
    expect(agentLoopOperationSource).toContain('this.sessionRunControlOperation.cleanupInterruptedRunsOnStartup()');
    expect(agentLoopOperationSource).not.toContain('this.activeSessionMessageRuns.get(payload.targetRequestId)');
    expect(agentLoopOperationSource).not.toContain('this.runTerminalCoordinator.cancelActiveSessionMessageRun({');
    expect(agentLoopOperationSource).not.toContain('this.runTerminalCoordinator.cleanupInterruptedRunsOnStartup({');
    expect(agentLoopOperationSource).not.toContain('this.runRetryCoordinator.createManualRetryFromRun(input)');
    expect(agentLoopOperationSource).not.toContain('this.runRetryCoordinator.createManualRerunFromUserMessage(input)');
    expect(sessionRunControlOperationSource).toContain('export class SessionRunControlOperation');
    expect(sessionRunControlOperationSource).toContain('cancelActiveSessionMessageRun({');
    expect(sessionRunControlOperationSource).toContain('cleanupInterruptedRunsOnStartup({');
  });

  it('keeps runtime event sequence and request metadata normalization in the events owner', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const terminalCoordinatorSource = readFileSync(join(repoRoot, 'packages/coding-agent/state/run-terminal-coordinator.ts'), 'utf8');
    const retryCoordinatorSource = readFileSync(join(repoRoot, 'packages/coding-agent/state/run-retry-coordinator.ts'), 'utf8');
    const eventLogSource = readFileSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-log.ts'), 'utf8');
    const eventPublisherSource = readFileSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-publisher.ts'), 'utf8');

    expect(agentLoopOperationSource).toContain('private readonly runtimeEventLog: RuntimeEventLog');
    expect(agentLoopOperationSource).toContain('private readonly runtimeEventPublisher: RuntimeEventPublisher<ChatStreamEventAdapter>');
    expect(agentLoopOperationSource).not.toContain('withRequestMetadata(');
    expect(agentLoopOperationSource).not.toContain('withSequenceAfter(');
    expect(agentLoopOperationSource).not.toContain('withSessionMessageRequestMetadata(');
    expect(agentLoopOperationSource).not.toContain('onTerminalEvent:');
    expect(agentLoopOperationSource).not.toContain('private publishRunTerminalEventHooks');
    expect(agentLoopOperationSource).not.toContain('function nextRuntimeSequence');
    expect(terminalCoordinatorSource).not.toContain('function nextRuntimeSequence');
    expect(retryCoordinatorSource).not.toContain('function nextRuntimeSequence');
    expect(eventLogSource).toContain('export class RuntimeEventLog');
    expect(eventLogSource).toContain('export class RuntimeEventSequenceCursor');
    expect(eventPublisherSource).toContain('export class RuntimeEventPublisher');
    expect(eventPublisherSource).toContain('publishRunTerminalHooks');
  });

  it('keeps memory recall cwd resolution in the context owner', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');
    const initialModelInputPreparationSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/context/initial-model-input-preparation.ts'),
      'utf8',
    );
    const contextEffectiveCwdSource = readFileSync(join(repoRoot, 'packages/coding-agent/context/effective-cwd.ts'), 'utf8');
    const modelInputContextBuilderSource = readFileSync(join(repoRoot, 'packages/coding-agent/context/model-input-context-builder.ts'), 'utf8');

    expect(agentLoopSource).not.toContain('resolveMemoryRecallEffectiveCwd');
    expect(agentLoopSource).not.toContain('function resolveRecallEffectiveCwd');
    expect(agentLoopSource).not.toContain('const DEFAULT_CONTEXT_BUDGET_POLICY');
    expect(agentLoopOperationSource).not.toContain('function resolveRecallEffectiveCwd');
    expect(agentLoopOperationSource).not.toContain('const DEFAULT_CONTEXT_BUDGET_POLICY');
    expect(initialModelInputPreparationSource).toContain('resolveMemoryRecallEffectiveCwd');
    expect(initialModelInputPreparationSource).toContain('DEFAULT_CONTEXT_BUDGET_POLICY');
    expect(modelInputContextBuilderSource).toContain('export const DEFAULT_CONTEXT_BUDGET_POLICY');
    expect(contextEffectiveCwdSource).toContain('export function resolveMemoryRecallEffectiveCwd');
  });

  it('keeps ToolSet selection in the agent loop owner', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');
    const toolsDefinitionsPath = join(repoRoot, 'packages/coding-agent/tools/definitions/model-visible-tool-definitions.ts');

    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/turn'))).toBe(false);
    expect(agentLoopOperationSource).not.toContain('prepareToolSet({');
    expect(agentLoopOperationSource).not.toContain('prepareToolRunner({');
    expect(agentLoopOperationSource).not.toContain('toolCallRunnerFactory.create');
    expect(agentLoopOperationSource).not.toContain('createToolRegistrySnapshotForCodingAgentRun');
    expect(agentLoopOperationSource).not.toContain('createToolRegistrySnapshotCreatedEvent');
    expect(agentLoopSource).toContain('export class ToolSetService');
    expect(agentLoopSource).toContain('export function createToolSetSnapshotProvider');
    expect(agentLoopSource).toContain('export class AgentLoop');
    expect(agentLoopSource).toContain('prepareToolSet');
    expect(agentLoopSource).toContain('export async function prepareToolRunner');
    expect(agentLoopSource).toContain('getProviderCapabilitySummary');
    expect(agentLoopSource).toContain('createRunSnapshot');
    expect(agentLoopSource).toContain('listDefinitions');
    expect(existsSync(toolsDefinitionsPath)).toBe(false);
  });

  it('wires the agent-loop operation through split repository owner ports in session runtime composition', () => {
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(sessionRuntimeSource).not.toContain('SessionRunRepository');
    expect(sessionRuntimeSource).not.toContain('sessionRunRepository');
    expect(sessionRuntimeSource).toContain("import { createAgentLoopOperationRepositoryOptions } from './agent-loop-operation-repository-options'");
    expect(sessionRuntimeSource).not.toContain('function createAgentLoopOperationRepositoryOptions');
    expect(sessionRuntimeSource).not.toContain('repository: agentRunRepository,');
    expect(sessionRuntimeSource).toContain('...agentLoopOperationRepositoryOptions');
    expect(runtimeSource).toContain('modelStepRepository: persistence.modelStepRepository');
    expect(runtimeSource).not.toContain('sessionRunRepository: persistence.sessionRunRepository');
  });

  it('keeps default AgentLoopOperation persistence composition outside the run service owner', () => {
    const agentLoopOperationSource = readFileSync(join(repoRoot, 'packages/coding-agent/product-runtime/agent-loop-operation.ts'), 'utf8');

    expect(agentLoopOperationSource).not.toContain('sessionRunRepository');
    expect(agentLoopOperationSource).not.toContain('composeCodingAgentPersistence');
    expect(agentLoopOperationSource).not.toContain('createDefaultAgentRunRepositoryPort');
    expect(agentLoopOperationSource).not.toContain('createDefaultAgentLoopOperation(');
    expect(agentLoopOperationSource).not.toContain('new PermissionSnapshotService');
    expect(agentLoopOperationSource).not.toContain('new PlanArtifactService');
    expect(agentLoopOperationSource).not.toContain('new ToolRegistrySnapshotService');
  });

  it('keeps the session-run facade out of public persistence composition', () => {
    const persistenceCompositionSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-persistence.ts'),
      'utf8',
    );
    const persistenceIndexSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/index.ts'),
      'utf8',
    );

    expect(persistenceCompositionSource).not.toContain('SessionRunRepository');
    expect(persistenceCompositionSource).not.toContain('sessionRunRepository');
    expect(persistenceIndexSource).not.toContain('session-run.repo');
  });
});
