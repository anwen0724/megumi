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
    const runContractSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/run-contract.ts'), 'utf8');
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');
    const retryCoordinatorSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/run/lifecycle/run-retry-coordinator.ts'),
      'utf8',
    );

    expect(runContractSource).not.toContain('SessionRunRepository');
    expect(agentRunServiceSource).not.toContain('SessionRunRepository');
    expect(retryCoordinatorSource).not.toContain('SessionRunRepository');
    expect(runContractSource).not.toContain('export interface AgentRunRepositoryPort {');
    expect(runContractSource).not.toContain('export type AgentRunRepositoryPort =');
    expect(runContractSource).toContain('export interface AgentRunSessionRepositoryPort');
    expect(runContractSource).toContain('export interface AgentRunRunRecordRepositoryPort');
    expect(runContractSource).toContain('export interface AgentRunExecutionFactRepositoryPort');
    expect(runContractSource).toContain('export interface AgentRunModelStepRepositoryPort');
    expect(runContractSource).toContain('export interface AgentRunRuntimeEventRepositoryPort');
    expect(retryCoordinatorSource).toContain('export interface RunRetryCoordinatorRepositoryPort');
  });

  it('keeps AgentRunService options on owner-named repository ports', () => {
    const runContractSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/run-contract.ts'), 'utf8');
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');

    expect(runContractSource).not.toContain('repository: AgentRunRepositoryPort;');
    expect(runContractSource).toContain('sessionRepository: AgentRunSessionRepositoryPort;');
    expect(runContractSource).toContain('messageRepository: AgentRunMessageRepositoryPort;');
    expect(runContractSource).toContain('runRecordRepository: AgentRunRunRecordRepositoryPort;');
    expect(runContractSource).toContain('runExecutionFactRepository: AgentRunExecutionFactRepositoryPort;');
    expect(runContractSource).toContain('modelStepRepository: AgentRunModelStepRepositoryPort;');
    expect(runContractSource).toContain('sessionContextRepository: AgentRunSessionContextRepositoryPort;');
    expect(runContractSource).toContain('runtimeEventRepository: AgentRunRuntimeEventRepositoryPort;');
    expect(agentRunServiceSource).not.toContain('const repository = options.repository');
  });

  it('keeps AgentRunService coordinator repository adapters in composition', () => {
    const runContractSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/run-contract.ts'), 'utf8');
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');
    const repositoryOptionsSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/agent-run-repository-options.ts'),
      'utf8',
    );

    expect(runContractSource).not.toContain('runCompletionRepository: RunCompletionHooksRepositoryPort;');
    expect(runContractSource).not.toContain('runTerminalRepository: RunTerminalRepositoryPort;');
    expect(runContractSource).not.toContain('runRetryRepository: RunRetryCoordinatorRepositoryPort;');
    expect(agentRunServiceSource).not.toContain('private readonly runCompletionRepository');
    expect(agentRunServiceSource).not.toContain('private readonly runTerminalRepository');
    expect(agentRunServiceSource).not.toContain('private readonly runRetryRepository');
    expect(agentRunServiceSource).not.toContain('this.runCompletionRepository = options.runCompletionRepository');
    expect(agentRunServiceSource).not.toContain('this.runTerminalRepository = options.runTerminalRepository');
    expect(agentRunServiceSource).not.toContain('this.runRetryRepository = options.runRetryRepository');
    expect(agentRunServiceSource).not.toContain('this.runCompletionRepository = {');
    expect(agentRunServiceSource).not.toContain('this.runTerminalRepository = {');
    expect(agentRunServiceSource).not.toContain('this.runRetryRepository = {');
    expect(repositoryOptionsSource).toContain('runCompletionRepository');
    expect(repositoryOptionsSource).toContain('runTerminalRepository');
    expect(repositoryOptionsSource).toContain('runRetryRepository');
  });

  it('keeps AgentRunService coordinator construction in composition', () => {
    const runContractSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/run-contract.ts'), 'utf8');
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const defaultAgentRunServiceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/create-default-agent-run-service.ts'),
      'utf8',
    );

    expect(runContractSource).toContain('runCompletionHooks: AgentRunCompletionHooksPort;');
    expect(runContractSource).toContain('runTerminalCoordinator: AgentRunTerminalCoordinatorPort;');
    expect(runContractSource).toContain('runRetryCoordinator: AgentRunRetryCoordinatorPort;');
    expect(agentRunServiceSource).not.toContain('new RunCompletionHooksCoordinator');
    expect(agentRunServiceSource).not.toContain('new RunTerminalCoordinator');
    expect(agentRunServiceSource).not.toContain('new RunRetryCoordinator');
    expect(agentRunServiceSource).toContain('this.runCompletionHooks = options.runCompletionHooks');
    expect(agentRunServiceSource).toContain('this.runTerminalCoordinator = options.runTerminalCoordinator');
    expect(agentRunServiceSource).toContain('this.runRetryCoordinator = options.runRetryCoordinator');
    expect(sessionRuntimeSource).toContain('new RunCompletionHooksCoordinator');
    expect(sessionRuntimeSource).toContain('new RunTerminalCoordinator');
    expect(sessionRuntimeSource).toContain('new RunRetryCoordinator');
    expect(defaultAgentRunServiceSource).toContain('new RunCompletionHooksCoordinator');
    expect(defaultAgentRunServiceSource).toContain('new RunTerminalCoordinator');
    expect(defaultAgentRunServiceSource).toContain('new RunRetryCoordinator');
  });

  it('keeps approval resume event shaping in the approval submodule', () => {
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');
    const approvalResumeEventsPath = join(
      repoRoot,
      'packages/coding-agent/run/tool-calls/approval/approval-resume-events.ts',
    );

    expect(existsSync(approvalResumeEventsPath)).toBe(true);
    const approvalResumeEventsSource = readFileSync(approvalResumeEventsPath, 'utf8');
    expect(agentRunServiceSource).not.toContain('private persistResumeRuntimeEvents');
    expect(agentRunServiceSource).not.toContain('private createToolResultRuntimeEvent');
    expect(agentRunServiceSource).not.toContain('function createToolResultSummary');
    expect(agentRunServiceSource).not.toContain("eventType: 'approval.resolved'");
    expect(approvalResumeEventsSource).toContain('export function persistResumeRuntimeEvents');
    expect(approvalResumeEventsSource).toContain('export function createToolResultRuntimeEvent');
    expect(approvalResumeEventsSource).toContain('export function createApprovalResolvedRuntimeEvent');
  });

  it('keeps approval resume run status restoration in lifecycle', () => {
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');
    const approvalResumeLifecyclePath = join(
      repoRoot,
      'packages/coding-agent/run/lifecycle/run-approval-resume.ts',
    );

    expect(existsSync(approvalResumeLifecyclePath)).toBe(true);
    const approvalResumeLifecycleSource = readFileSync(approvalResumeLifecyclePath, 'utf8');
    expect(agentRunServiceSource).not.toContain("assertRunStatusTransition(persistedRun.status, 'running')");
    expect(agentRunServiceSource).not.toContain("from: 'waiting_for_approval',\n      to: 'running'");
    expect(approvalResumeLifecycleSource).toContain('export function resumeRunAfterApproval');
    expect(approvalResumeLifecycleSource).toContain("from: 'waiting_for_approval'");
    expect(approvalResumeLifecycleSource).toContain("to: 'running'");
  });

  it('keeps AgentRunService internals on owner-named repository ports', () => {
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');

    expect(agentRunServiceSource).not.toContain('private readonly repository: AgentRunRepositoryPort');
    expect(agentRunServiceSource).not.toContain('this.repository = options.repository');
    expect(agentRunServiceSource).toContain('private readonly sessionRepository: AgentRunSessionRepositoryPort');
    expect(agentRunServiceSource).toContain('private readonly runRecordRepository: AgentRunRunRecordRepositoryPort');
    expect(agentRunServiceSource).toContain('private readonly runtimeEventRepository: AgentRunRuntimeEventRepositoryPort');
    expect(agentRunServiceSource).toContain('sessionRepository: this.sessionRepository');
    expect(agentRunServiceSource).not.toContain('repository: this.runTerminalRepository');
    expect(agentRunServiceSource).not.toContain('repository: this.runRetryRepository');
    expect(agentRunServiceSource).not.toContain('repository: this.runCompletionRepository');
  });

  it('wires agent run service through split repository owner ports in session runtime composition', () => {
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
    expect(sessionRuntimeSource).toContain("import { createAgentRunRepositoryOptions } from './agent-run-repository-options'");
    expect(sessionRuntimeSource).not.toContain('function createAgentRunRepositoryOptions');
    expect(sessionRuntimeSource).not.toContain('repository: agentRunRepository,');
    expect(sessionRuntimeSource).toContain('...agentRunRepositoryOptions');
    expect(runtimeSource).toContain('modelStepRepository: persistence.modelStepRepository');
    expect(runtimeSource).not.toContain('sessionRunRepository: persistence.sessionRunRepository');
  });

  it('keeps default AgentRunService persistence composition outside the run service owner', () => {
    const agentRunServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/run/agent-run-service.ts'), 'utf8');

    expect(agentRunServiceSource).not.toContain('sessionRunRepository');
    expect(agentRunServiceSource).not.toContain('composeCodingAgentPersistence');
    expect(agentRunServiceSource).not.toContain('createDefaultAgentRunRepositoryPort');
    expect(agentRunServiceSource).not.toContain('createDefaultAgentRunService(');
    expect(agentRunServiceSource).not.toContain('new PermissionSnapshotService');
    expect(agentRunServiceSource).not.toContain('new PlanArtifactService');
    expect(agentRunServiceSource).not.toContain('new ToolRegistrySnapshotService');
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
