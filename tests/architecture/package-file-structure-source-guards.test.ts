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

function listTopLevel(path: string): string[] {
  const absolute = join(repoRoot, path);
  if (!existsSync(absolute)) {
    return [];
  }

  return readdirSync(absolute).sort();
}

function sourceUnder(path: string): string {
  return filesUnder(path)
    .map((file) => read(file))
    .join('\n');
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
    expect(existsSync(join(repoRoot, 'packages/shared/input'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/shared/hook'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/shared/settings'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/contracts/run-input-preprocessing-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/hooks/contracts/input-hook-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/settings/contracts/settings-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/settings/core/settings-resolution.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/settings/services/product-settings.ts'))).toBe(true);
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

  it('keeps selected module owned contracts out of shared and hides core internals from external production imports', () => {
    const externalProductionFiles = productionFiles().filter((path) => (
      !path.startsWith('packages/coding-agent/commands/')
      && !path.startsWith('packages/coding-agent/hooks/')
      && !path.startsWith('packages/coding-agent/settings/')
    ));

    expect(offenders(productionFiles(), [
      /@megumi\/shared\/input\b/,
      /@megumi\/shared\/hook\b/,
      /@megumi\/shared\/settings\b/,
    ])).toEqual([]);
    expect(offenders(externalProductionFiles, [
      /@megumi\/coding-agent\/(?:commands|hooks|settings)\/core\b/,
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
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-input/model-call-input-builder.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-input/model-call-context.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-input/model-input-context-builder.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-input/parts/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/core/context-compaction.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/services/context-compaction-service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/context/compaction/index.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/adapters/local/context/agent-instruction-source.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/run-context/index.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/session/contracts/session-contracts.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/session/services/session-service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/session/repositories/session-repository.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/session/core/session-path.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/session/session-context-input.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/input/preprocessing/index.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/preprocessing/session-message-input-preprocessing.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/context'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/runtime-input.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/events/runtime-event-factory.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/lifecycle/run-state-policy.ts'))).toBe(false);
    expect(readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-input/model-call-input-builder.ts'), 'utf8'))
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
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-call/model-call-runner.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/tools/adapters/built-in-tools.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/adapters/local/settings/settings-json-storage.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/settings/app-settings.service.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'apps/desktop/src/main/services/security/secret-store.service.ts'))).toBe(false);
  });

  it('keeps the tools module on the target service-oriented structure', () => {
    expect(listTopLevel('packages/coding-agent/tools')).toEqual([
      'adapters',
      'contracts',
      'core',
      'index.ts',
      'services',
    ]);
    expect(sourceUnder('packages/coding-agent/tools')).toContain('class ToolRegistryService');
    expect(sourceUnder('packages/coding-agent/tools')).toContain('class ToolExecutionService');
    expect(sourceUnder('packages/coding-agent/tools')).toContain('registeredToolName');
    expect(read('packages/coding-agent/tools/index.ts')).not.toContain('ToolRegistrySnapshotService');
    expect(read('packages/coding-agent/tools/index.ts')).not.toContain('createToolExecutionRouter');
    expect(read('packages/coding-agent/tools/index.ts')).not.toContain('ToolService');
    expect(sourceUnder('packages/coding-agent/tools')).not.toContain('createExternalTestToolSourceExecutor');
    expect(sourceUnder('packages/coding-agent/tools/services')).not.toContain('resolveApproval');
    expect(sourceUnder('packages/coding-agent/tools/services')).not.toContain('permissionDecision');
    expect(sourceUnder('packages/coding-agent/tools')).not.toContain('external_test');
    expect(sourceUnder('packages/coding-agent/tools')).not.toContain('ToolRegistrySnapshot');
  });

  it('keeps runtime event persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/agent-loop.repo.ts');

    expect(existsSync(ownerPath)).toBe(true);
    expect(readFileSync(ownerPath, 'utf8')).toContain('INSERT INTO agent_loop_events');
    expect(existsSync(join(repoRoot, 'packages/coding-agent/persistence/repos/session-run.repo.ts'))).toBe(false);
  });

  it('keeps Workspace on the v2 public service surface', () => {
    const workspaceIndex = read('packages/coding-agent/workspace/index.ts');

    expect(workspaceIndex).toContain('./services/workspace-service');
    expect(workspaceIndex).toContain('./services/workspace-path-policy-service');
    expect(workspaceIndex).toContain('./services/workspace-change-service');
    expect(workspaceIndex).not.toContain('ProjectService');
    expect(workspaceIndex).not.toContain('createProjectService');
    expect(workspaceIndex).not.toContain('WorkspaceRestoreService');
    expect(workspaceIndex).not.toContain('WorkspaceChangeTrackerService');
    expect(workspaceIndex).not.toContain('workspace-change-footer-projector');
  });

  it('keeps agent-loop lifecycle facts as current agent-loop events, not compat run facts', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/agent-loop.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO agent_loop_events');
    expect(ownerSource).toContain("kind: 'step'");
    expect(ownerSource).toContain("kind: 'action'");
    expect(ownerSource).toContain("kind: 'observation'");
    expect(ownerSource).not.toContain("kind: 'run_step'");
    expect(ownerSource).not.toContain("kind: 'run_action'");
    expect(ownerSource).not.toContain("kind: 'run_observation'");
    expect(ownerSource).not.toContain('compat:run_step');
    expect(ownerSource).not.toContain('compat:run_action');
    expect(ownerSource).not.toContain('compat:run_observation');
  });

  it('keeps model call persistence in its owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/agent-loop.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO model_calls');
    expect(ownerSource).toContain('SELECT * FROM model_calls');
    expect(ownerSource).toContain('saveModelCall');
    expect(ownerSource).toContain('getModelCall');
    expect(ownerSource).not.toContain('saveModelStep');
    expect(ownerSource).not.toContain('getModelStep');
    expect(ownerSource).not.toContain('ModelStepRecord');
  });

  it('keeps session message persistence in the Session module repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/session/repositories/session-repository.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO session_messages');
    expect(ownerSource).toContain('SELECT * FROM session_messages');
  });

  it('keeps session records in the Session module repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/session/repositories/session-repository.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO sessions');
    expect(ownerSource).toContain('SELECT * FROM sessions');
  });

  it('keeps run records in their owner repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/persistence/repos/agent-loop.repo.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO agent_loop_runs');
    expect(ownerSource).toContain('SELECT * FROM agent_loop_runs');
  });

  it('keeps session compaction persistence in the Session module repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/session/repositories/session-repository.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO session_compactions');
    expect(ownerSource).toContain('SELECT * FROM session_compactions');
  });

  it('keeps session context active-path transactions in the Session module repository', () => {
    const ownerPath = join(repoRoot, 'packages/coding-agent/session/repositories/session-repository.ts');
    const ownerSource = readFileSync(ownerPath, 'utf8');

    expect(existsSync(ownerPath)).toBe(true);
    expect(ownerSource).toContain('INSERT INTO session_entries');
    expect(ownerSource).toContain('UPDATE sessions');
    expect(ownerSource).toContain('session_message_attachments');
    expect(ownerSource).toContain('this.database.transaction');
  });

  it('wires context compaction through the Context module runtime', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );
    const normalizedAgentRunProcessingServiceSource = AgentRunProcessingServiceSource.replaceAll('\r\n', '\n');

    expect(AgentRunProcessingServiceSource).not.toContain('SessionCompactionOrchestrator');
    expect(AgentRunProcessingServiceSource).not.toContain('compactIfNeeded');
    expect(normalizedAgentRunProcessingServiceSource).not.toContain('repository: this.repository,\n            modelCallProvider: options.modelCallProvider');
    expect(sessionRuntimeSource).toContain('const sessionRepository = new SessionRepository(options.database)');
    expect(sessionRuntimeSource).toContain('composeCodingAgentContext');
    expect(sessionRuntimeSource).toContain('contextCompactionService');
    expect(runtimeSource).toContain('sessionRepository');
  });

  it('keeps context reads on the new Session service or repository boundary', () => {
    const contextRepositorySource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/context-repository.ts'),
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

    expect(contextRepositorySource).not.toContain('persistence/repos/session.repo');
    expect(contextRepositorySource).not.toContain('SessionContextInputService');
    expect(sessionRuntimeSource).toContain('new SessionRepository(options.database)');
    expect(sessionRuntimeSource).toContain('createSessionService({ repository: sessionRepository })');
    expect(runtimeSource).toContain('sessionRepository');
  });

  it('wires session service through the Session module repository', () => {
    const sessionServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/session/services/session-service.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(sessionServiceSource).not.toContain("SessionRunRepository");
    expect(sessionServiceSource).toContain('repository: SessionRepository');
    expect(sessionRuntimeSource).toContain('sessionRepository');
    expect(runtimeSource).toContain('sessionRuntime');
  });

  it('removes the old session branch service from the public Session module boundary', () => {
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );

    expect(existsSync(join(repoRoot, 'packages/coding-agent/session/session-branch-service.ts'))).toBe(false);
    expect(sessionRuntimeSource).not.toContain('new SessionBranchService');
  });

  it('wires recovery runtime through aggregate repositories', () => {
    const recoveryRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition', `compose-coding-agent-${'recovery'}-runtime.ts`),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(recoveryRuntimeSource).not.toContain('SessionRunRepository');
    expect(recoveryRuntimeSource).toContain('runRepository: AgentLoopRepository');
    expect(recoveryRuntimeSource).toContain('sessionRepository: SessionRepository');
    expect(runtimeSource).toContain('runRepository: agentLoopRepository');
    expect(runtimeSource).toContain('sessionRepository: sessionRepository');
  });

  it('wires tool runtime through the aggregate agent-loop repository', () => {
    const toolRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-tool-runtime.ts'),
      'utf8',
    );
    const runtimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'),
      'utf8',
    );

    expect(toolRuntimeSource).not.toContain('SessionRunRepository');
    expect(toolRuntimeSource).toContain('runRepository: AgentLoopRepository');
    expect(toolRuntimeSource).toContain('input.runRepository.getRun(runId)');
    expect(runtimeSource).toContain('runRepository: agentLoopRepository');
  });

  it('keeps run service contracts off the concrete session-run repository type', () => {
    const agentLoopRepositorySource = readFileSync(
      join(repoRoot, 'packages/coding-agent/persistence/repos/agent-loop.repo.ts'),
      'utf8',
    );
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const productRuntimeIndexSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/host-interface/index.ts'),
      'utf8',
    );
    const retryCoordinatorSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/state/run-retry-coordinator.ts'),
      'utf8',
    );

    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/run-contract.ts'))).toBe(false);
    expect(AgentRunProcessingServiceSource).not.toContain('SessionRunRepository');
    expect(retryCoordinatorSource).not.toContain('SessionRunRepository');
    expect(agentLoopRepositorySource).toContain('export class AgentLoopRepository');
    expect(retryCoordinatorSource).toContain('export interface RunRetryCoordinatorRepositoryPort');
    expect(productRuntimeIndexSource).toContain("export * from './host-interface'");
    expect(productRuntimeIndexSource).not.toContain("export * from './input/send-input'");
    expect(productRuntimeIndexSource).not.toContain("export * from '../state'");
  });

  it('keeps AgentRunProcessingService options on aggregate repository dependencies', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');

    expect(AgentRunProcessingServiceSource).toContain('sessionRepository: AgentRunSessionRepositoryPort');
    expect(AgentRunProcessingServiceSource).toContain('agentLoopRepository: AgentRunRepositoryPort');
    expect(AgentRunProcessingServiceSource).not.toContain('const repository = options.repository');
  });

  it('keeps model-call and tool runtime contracts in the agent-loop owner', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const modelCallContractSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/model-call/model-call-contract.ts'),
      'utf8',
    );
    const toolCallContractSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/tool-call-contract.ts'),
      'utf8',
    );

    expect(AgentRunProcessingServiceSource).not.toContain('export interface AgentRunModelStepProvider');
    expect(AgentRunProcessingServiceSource).not.toContain('export type AgentRunModelCallProvider');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface AgentRunToolRuntimeFactory');
    expect(modelCallContractSource).toContain('export interface ModelCallProvider');
    expect(toolCallContractSource).toContain('export interface ToolRuntimeFactory');
  });

  it('keeps AgentRunProcessingService coordinator dependencies on aggregate repositories', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );

    expect(AgentRunProcessingServiceSource).not.toContain('private readonly runCompletionRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('private readonly runTerminalRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('private readonly runRetryRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runCompletionRepository = options.runCompletionRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runTerminalRepository = options.runTerminalRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runRetryRepository = options.runRetryRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runCompletionRepository = {');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runTerminalRepository = {');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runRetryRepository = {');
    expect(existsSync(join(repoRoot, 'packages/coding-agent/composition/input-processing-repository-options.ts'))).toBe(false);
    expect(sessionRuntimeSource).toContain('agentLoopRepository: options.agentLoopRepository');
    expect(sessionRuntimeSource).toContain('sessionRepository: options.sessionRepository');
    expect(sessionRuntimeSource).toContain('toolCallRepository: options.toolCallRepository');
  });

  it('keeps AgentRunProcessingService coordinator construction in composition', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const sessionRuntimeSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts'),
      'utf8',
    );
    const defaultAgentRunProcessingServiceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/composition/create-default-agent-run-processing-service.ts'),
      'utf8',
    );
    const postRunHooksSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/hooks/contracts/post-run-hooks-contracts.ts'),
      'utf8',
    );
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
    const runContextServiceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/run-context/run-context-service.ts'),
      'utf8',
    );
    const agentInstructionSourceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/adapters/local/context/agent-instruction-source.ts'),
      'utf8',
    );
    const modelCallInputBuilderSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/model-input/model-call-input-builder.ts'),
      'utf8',
    );
    const modelInputSourceOverridesSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/model-input/model-input-source-overrides.ts'),
      'utf8',
    );
    const contextIndexSource = readFileSync(join(repoRoot, 'packages/coding-agent/context/index.ts'), 'utf8');
    const sessionServiceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/session/services/session-service.ts'),
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
    const productSettingsSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/settings/services/product-settings.ts'),
      'utf8',
    );
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/run-contract.ts'))).toBe(false);
    expect(AgentRunProcessingServiceSource).not.toContain('export interface AgentRunPostRunHooksPort');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface AgentRunTerminalCoordinatorPort');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface AgentRunRetryCoordinatorPort');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunWorkspaceChangeReadPort');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunToolDefinitionProvider');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunProviderCapabilitySummaryProvider');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunToolRegistrySnapshotService');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunContextService');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunAgentInstructionSourceService');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunSessionContextInputService');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunModelCallInputBuildService');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunGlobalInstructionDirectoryProvider');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunSessionInstructionSourceProvider');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunEffectiveCwdProvider');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunMemoryRecallService');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunMemoryCaptureService');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunMemorySettingsProvider');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface SessionRunMemoryMarkdownSyncService');
    expect(AgentRunProcessingServiceSource).not.toContain('export interface AgentRunProcessingServiceHomePaths');
    expect(sessionServiceSource).not.toContain('export interface SessionMemorySettingsProvider');
    expect(sessionServiceSource).not.toContain('SessionContextInput');
    expect(sessionServiceSource).not.toContain('export interface SessionMemoryMarkdownSyncService');
    expect(AgentRunProcessingServiceSource).toContain('postRunHooks: PostRunHooksPort;');
    expect(AgentRunProcessingServiceSource).toContain('runTerminalCoordinator: RunTerminalCoordinatorPort;');
    expect(AgentRunProcessingServiceSource).toContain('runRetryCoordinator: RunRetryCoordinatorPort;');
    expect(AgentRunProcessingServiceSource).toContain('workspaceChanges?: WorkspaceChangeReadPort;');
    expect(AgentRunProcessingServiceSource).toContain('toolDefinitionProvider?: ToolSetRegistryProvider;');
    expect(AgentRunProcessingServiceSource).toContain('providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;');
    expect(AgentRunProcessingServiceSource).not.toContain('toolRegistrySnapshotService');
    expect(AgentRunProcessingServiceSource).not.toContain('ToolRegistrySnapshotServicePort');
    expect(AgentRunProcessingServiceSource).toContain('contextService?: RunBaselineContextPort;');
    expect(AgentRunProcessingServiceSource).toContain('agentInstructionSourceService?: AgentInstructionSourcePort;');
    expect(AgentRunProcessingServiceSource).toContain('modelCallInputBuildService?: ModelCallInputBuildPort;');
    expect(AgentRunProcessingServiceSource).toContain('modelInputSourceOverrideProvider?: AgentLoopInitialModelInputSourceOverrideProvider;');
    expect(AgentRunProcessingServiceSource).toContain('sessionContextInputService?: SessionContextInputBuildPort;');
    expect(AgentRunProcessingServiceSource).toContain('memoryRecallService?: MemoryRecallPort;');
    expect(AgentRunProcessingServiceSource).not.toContain('memoryCaptureService?:');
    expect(AgentRunProcessingServiceSource).toContain('memorySettingsProvider?: MemorySettingsPort;');
    expect(AgentRunProcessingServiceSource).toContain('memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;');
    expect(postRunHooksSource).toContain('export interface PostRunHooksPort');
    expect(runTerminalCoordinatorSource).toContain('export interface RunTerminalCoordinatorPort');
    expect(runRetryCoordinatorSource).toContain('export interface RunRetryCoordinatorPort');
    expect(workspaceChangeReadSource).toContain('export interface WorkspaceChangeReadPort');
    expect(workspaceIndexSource).toContain("export * from './services/workspace-service';");
    expect(workspaceIndexSource).toContain("export * from './services/workspace-path-policy-service';");
    expect(workspaceIndexSource).toContain("export * from './services/workspace-change-service';");
    expect(agentLoopSource).toContain('export interface ToolSetRegistryProvider');
    expect(agentLoopSource).toContain('export interface ToolSetCapabilityProvider');
    expect(runContextServiceSource).toContain('export interface RunBaselineContextPort');
    expect(agentInstructionSourceSource).toContain('export interface AgentInstructionSourcePort');
    expect(modelCallInputBuilderSource).toContain('export interface ModelCallInputBuildPort');
    expect(modelInputSourceOverridesSource).toContain('export class ModelInputSourceOverrideService');
    expect(modelInputSourceOverridesSource).toContain('export interface ModelInputGlobalInstructionDirectoryProvider');
    expect(modelInputSourceOverridesSource).toContain('export interface ModelInputSessionInstructionSourceProvider');
    expect(modelInputSourceOverridesSource).toContain('export interface ModelInputEffectiveCwdProvider');
    expect(contextIndexSource).not.toContain("export * from './model-input-source-overrides';");
    expect(existsSync(join(repoRoot, 'packages/coding-agent/session/session-context-input.ts'))).toBe(false);
    expect(AgentRunProcessingServiceSource).toContain('export interface SessionContextInputBuildPort');
    expect(memoryRecallRuntimeSource).toContain('export interface MemoryRecallPort');
    expect(memoryCaptureRuntimeSource).toContain('export interface MemoryCapturePort');
    expect(memoryRuntimePortsSource).toContain('export interface MemoryProjectMirrorSyncPort');
    expect(productSettingsSource).toContain('export interface MemorySettingsPort');
    expect(AgentRunProcessingServiceSource).not.toContain('new RunCompletionHooksCoordinator');
    expect(AgentRunProcessingServiceSource).not.toContain('new PostRunHooksCoordinator');
    expect(AgentRunProcessingServiceSource).not.toContain('new RunTerminalCoordinator');
    expect(AgentRunProcessingServiceSource).not.toContain('new RunRetryCoordinator');
    expect(AgentRunProcessingServiceSource).toContain('this.postRunHooks = options.postRunHooks');
    expect(AgentRunProcessingServiceSource).not.toContain('private readonly runTerminalCoordinator');
    expect(AgentRunProcessingServiceSource).not.toContain('private readonly runRetryCoordinator');
    expect(AgentRunProcessingServiceSource).toContain('terminalCoordinator: options.runTerminalCoordinator');
    expect(AgentRunProcessingServiceSource).toContain('retryCoordinator: options.runRetryCoordinator');
    expect(sessionRuntimeSource).toContain("from '../hooks'");
    expect(sessionRuntimeSource).toContain("from '../state'");
    expect(sessionRuntimeSource).toContain('new PostRunHooksCoordinator');
    expect(sessionRuntimeSource).toContain('new RunTerminalCoordinator');
    expect(sessionRuntimeSource).toContain('new RunRetryCoordinator');
    expect(defaultAgentRunProcessingServiceSource).toContain("from '../hooks'");
    expect(defaultAgentRunProcessingServiceSource).toContain("from '../state'");
    expect(defaultAgentRunProcessingServiceSource).toContain('export interface CreateDefaultAgentRunProcessingServiceHomePaths');
    expect(defaultAgentRunProcessingServiceSource).toContain('new PostRunHooksCoordinator');
    expect(defaultAgentRunProcessingServiceSource).toContain('new RunTerminalCoordinator');
    expect(defaultAgentRunProcessingServiceSource).toContain('new RunRetryCoordinator');
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
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const approvalResumeEventsPath = join(
      repoRoot,
      'packages/coding-agent/agent-loop/tool-call/approval/approval-resume-events.ts',
    );

    expect(existsSync(approvalResumeEventsPath)).toBe(true);
    const approvalResumeEventsSource = readFileSync(approvalResumeEventsPath, 'utf8');
    expect(AgentRunProcessingServiceSource).not.toContain('private persistResumeRuntimeEvents');
    expect(AgentRunProcessingServiceSource).not.toContain('private createToolResultRuntimeEvent');
    expect(AgentRunProcessingServiceSource).not.toContain('function createToolResultSummary');
    expect(AgentRunProcessingServiceSource).not.toContain("eventType: 'approval.resolved'");
    expect(AgentRunProcessingServiceSource).not.toContain('resumeEvents.toolResultIdsWithEvents');
    expect(AgentRunProcessingServiceSource).not.toContain('for (const toolResult of toolResults)');
    expect(approvalResumeEventsSource).toContain('export function persistResumeRuntimeEvents');
    expect(approvalResumeEventsSource).toContain('export function createToolResultRuntimeEvent');
    expect(approvalResumeEventsSource).toContain('export function createApprovalResolvedRuntimeEvent');
    expect(approvalResumeEventsSource).toContain('export function collectApprovalResumeRuntimeEvents');
  });

  it('keeps approval resume registry mutation in the approval submodule', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const pendingApprovalRegistrySource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/approval/pending-approval-registry.ts'),
      'utf8',
    );
    const approvalResumeGroupSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/approval/approval-resume-group.ts'),
      'utf8',
    );

    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.pendingByApprovalId.delete(input.approvalRequestId)');
    expect(AgentRunProcessingServiceSource).not.toContain('this.pendingApprovalRegistry.deleteApproval(input.approvalRequestId)');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.resolvedResults.push(...toolResults)');
    expect(AgentRunProcessingServiceSource).not.toContain('this.pendingApprovalRegistry.deleteGroup(approvalResume.groupId)');
    expect(AgentRunProcessingServiceSource).not.toContain('const group: AgentRunApprovalResumeGroup');
    expect(AgentRunProcessingServiceSource).not.toContain('pendingByApprovalId: new Map(input.pendingApprovalResumes');
    expect(AgentRunProcessingServiceSource).not.toContain('waitForAgentLoopApproval({');
    expect(pendingApprovalRegistrySource).toContain('export function resolvePendingApproval');
    expect(pendingApprovalRegistrySource).toContain('export function closePendingApprovalGroup');
    expect(approvalResumeGroupSource).toContain('export function registerApprovalResumeGroup');
    expect(approvalResumeGroupSource).toContain('waitForAgentLoopApproval');
  });

  it('keeps tool result model input emission ownership in the model-input submodule', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
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
    expect(existsSync(join(repoRoot, 'packages/coding-agent/composition/input-processing-tool-repository-adapter.ts'))).toBe(false);
    expect(composeCodingAgentToolRuntimeSource).toContain('markToolResultsSubmittedToModelInput');
    expect(toolResultModelInputEmittedSource).toContain('export function markToolResultsSubmittedToModelInput');
    expect(toolResultModelInputEmittedSource).toContain('createToolResultsSubmittedToModelInputEvent');
  });

  it('keeps approval resume model input preparation in the approval submodule', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const approvalResumeModelInputPath = join(
      repoRoot,
      'packages/coding-agent/agent-loop/tool-call/approval/approval-resume-model-input.ts',
    );

    expect(existsSync(approvalResumeModelInputPath)).toBe(true);
    const approvalResumeModelInputSource = readFileSync(approvalResumeModelInputPath, 'utf8');
    expect(AgentRunProcessingServiceSource).not.toContain("contextKind: 'approval-resume'");
    expect(AgentRunProcessingServiceSource).not.toContain('pending.accumulatedToolResults');
    expect(AgentRunProcessingServiceSource).not.toContain('pending.accumulatedProviderStates');
    expect(approvalResumeModelInputSource).toContain('export async function prepareApprovalResumeModelInput');
  });

  it('keeps approval resume internals behind ToolCallRunner public capabilities', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');
    const toolCallsIndexSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/index.ts'), 'utf8');
    const toolCallRunnerSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts'),
      'utf8',
    );

    expect(toolCallsIndexSource).not.toContain("export * from './approval/");
    expect(toolCallsIndexSource).not.toContain("export * from './model-input/");
    expect(AgentRunProcessingServiceSource).not.toContain('closePendingApprovalGroup,');
    expect(AgentRunProcessingServiceSource).not.toContain('collectApprovalResumeRuntimeEvents,');
    expect(AgentRunProcessingServiceSource).not.toContain('createApprovalResolvedRuntimeEvent,');
    expect(AgentRunProcessingServiceSource).not.toContain('prepareApprovalResumeModelInput,');
    expect(AgentRunProcessingServiceSource).not.toContain('resolvePendingApproval,');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.toolRuntime.resumeToolApproval(input)');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.toolRuntime.createApprovalResolvedRuntimeEvent');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.toolRuntime.prepareApprovalResumeModelInput');
    expect(agentLoopSource).toContain('approvalResume.toolRuntime.resumeToolApproval');
    expect(agentLoopSource).toContain('approvalResume.toolRuntime.createApprovalResolvedRuntimeEvent');
    expect(agentLoopSource).toContain('approvalResume.toolRuntime.prepareApprovalResumeModelInput');
    expect(toolCallRunnerSource).toContain('createApprovalResolvedRuntimeEvent');
    expect(toolCallRunnerSource).toContain('prepareApprovalResumeModelInput');
    expect(toolCallRunnerSource).toContain('markToolResultsSubmittedToModelInput');
  });

  it('keeps approval resume model loop wiring in the top-level agent-loop owner', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');

    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/loop'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/turn'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/approval-resume-model-loop.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-tool-loop-stream.ts'))).toBe(false);
    expect(AgentRunProcessingServiceSource).not.toContain('const resumedRequest: ModelStepRuntimeRequest');
    expect(AgentRunProcessingServiceSource).not.toContain('const resumedModelEvents = streamCodingAgentModelToolLoop({');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.toolRuntime.resolvePendingApproval');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.toolRuntime.closePendingApprovalGroup');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.toolRuntime.collectApprovalResumeRuntimeEvents');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.toolRuntime.prepareApprovalResumeModelInput');
    expect(AgentRunProcessingServiceSource).not.toContain('approvalResume.toolRuntime.markToolResultsSubmittedToModelInput');
    expect(AgentRunProcessingServiceSource).toContain("from '../agent-loop'");
    expect(AgentRunProcessingServiceSource).toContain('resumeToolApprovalAgentLoop({');
    expect(agentLoopSource).toContain('export function streamApprovalResumeModelLoop');
    expect(agentLoopSource).toContain('export async function* resumeToolApprovalAgentLoop');
    expect(agentLoopSource).toContain('export async function* streamCodingAgentModelToolLoop');
  });

  it('keeps model-call event recording in the top-level agent-loop owner', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');

    expect(AgentRunProcessingServiceSource).not.toContain('private async *persistModelCallEvents');
    expect(AgentRunProcessingServiceSource).not.toContain('assistantContent += getAssistantDeltaContent');
    expect(AgentRunProcessingServiceSource).not.toContain('this.sessionMessageService.commitAssistantReply({');
    expect(AgentRunProcessingServiceSource).not.toContain('this.postRunHooks.scheduleRunCompletedMemoryCapture({');
    expect(AgentRunProcessingServiceSource).toContain('createAgentLoopEventRecorder<');
    expect(agentLoopSource).toContain('export function createAgentLoopEventRecorder');
    expect(agentLoopSource).toContain('registerApprovalResumeGroup({');
    expect(agentLoopSource).toContain('completeAgentLoopModelCall({');
  });

  it('keeps approval resume run status restoration in top-level state owner', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const approvalResumeStatePath = join(
      repoRoot,
      'packages/coding-agent/state/run-approval-resume.ts',
    );

    expect(existsSync(approvalResumeStatePath)).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/lifecycle/run-approval-resume.ts'))).toBe(false);
    const approvalResumeStateSource = readFileSync(approvalResumeStatePath, 'utf8');
    expect(AgentRunProcessingServiceSource).not.toContain("assertRunStatusTransition(persistedRun.status, 'running')");
    expect(AgentRunProcessingServiceSource).not.toContain("from: 'waiting_for_approval',\n      to: 'running'");
    expect(approvalResumeStateSource).toContain('export function resumeRunAfterApproval');
    expect(approvalResumeStateSource).toContain("from: 'waiting_for_approval'");
    expect(approvalResumeStateSource).toContain("to: 'running'");
  });

  it('keeps AgentRunProcessingService internals on owner-named repository ports', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const submitInputOperationSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'),
      'utf8',
    );

    expect(AgentRunProcessingServiceSource).not.toContain('private readonly repository: AgentRunRepositoryPort');
    expect(AgentRunProcessingServiceSource).not.toContain('this.repository = options.repository');
    expect(AgentRunProcessingServiceSource).toContain('private readonly sessionRepository: AgentRunSessionRepositoryPort');
    expect(AgentRunProcessingServiceSource).toContain('private readonly agentLoopRepository: AgentRunRepositoryPort');
    expect(AgentRunProcessingServiceSource).not.toContain('private readonly sessionMessageService: SessionMessageService');
    expect(AgentRunProcessingServiceSource).toContain('sessionService?: Pick<SessionModuleService');
    expect(AgentRunProcessingServiceSource).toContain('sessionService,');
    expect(AgentRunProcessingServiceSource).not.toContain('private resolveSessionForMessage');
    expect(AgentRunProcessingServiceSource).not.toContain('private appendSourceAndMoveLeaf');
    expect(AgentRunProcessingServiceSource).not.toContain('private assertActiveBranchDraftMarker');
    expect(AgentRunProcessingServiceSource).not.toContain('private recordManualRerunAttemptForBranchDraft');
    expect(AgentRunProcessingServiceSource).not.toContain('function sessionMessageSourceRef');
    expect(AgentRunProcessingServiceSource).not.toContain('function sessionRunSourceRef');
    expect(AgentRunProcessingServiceSource).not.toContain('assertActiveBranchDraftMarker as assertSessionActiveBranchDraftMarker');
    expect(AgentRunProcessingServiceSource).not.toContain('activePathRepository: this.requireActivePathRepository()');
    expect(AgentRunProcessingServiceSource).not.toContain('requireSessionBranchService');
    expect(submitInputOperationSource).toContain('options.sessionBranchService.assertActiveBranchDraftMarker');
    expect(submitInputOperationSource).toContain('options.runRetryCoordinator.recordManualRerunAttemptForBranchDraft');
    expect(AgentRunProcessingServiceSource).not.toContain('repository: this.runTerminalRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('repository: this.runRetryRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('repository: this.runCompletionRepository');
  });

  it('keeps user input submission inside input-service instead of a separate operation file', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const submitInputOperationSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'),
      'utf8',
    );

    expect(existsSync(join(repoRoot, 'packages/coding-agent/input/input-submission-operation.ts'))).toBe(false);
    expect(AgentRunProcessingServiceSource).toContain('handleAgentRunInput');
    expect(AgentRunProcessingServiceSource).toContain('submitUserInputToAgentLoop');
    expect(submitInputOperationSource).toContain('prepareSessionMessageInput({');
    expect(submitInputOperationSource).toContain('createRunPermissionSnapshot({');
    expect(submitInputOperationSource).toContain('createSessionMessageChatStreamAdapter({');
    expect(submitInputOperationSource).toContain('startAgentLoopRun({');
  });

  it('keeps session run control product operation out of the transitional AgentRunProcessingService facade', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const sessionRunControlServiceSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/state/session-run-control-service.ts'),
      'utf8',
    );

    expect(AgentRunProcessingServiceSource).toContain('this.sessionRunControlService.cancelSessionMessage(input)');
    expect(AgentRunProcessingServiceSource).toContain('this.sessionRunControlService.createManualRetryFromRun(input)');
    expect(AgentRunProcessingServiceSource).toContain('this.sessionRunControlService.createManualRerunFromUserMessage(input)');
    expect(AgentRunProcessingServiceSource).toContain('this.sessionRunControlService.cleanupInterruptedRunsOnStartup()');
    expect(AgentRunProcessingServiceSource).not.toContain('this.activeSessionMessageRuns.get(payload.targetRequestId)');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runTerminalCoordinator.cancelActiveSessionMessageRun({');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runTerminalCoordinator.cleanupInterruptedRunsOnStartup({');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runRetryCoordinator.createManualRetryFromRun(input)');
    expect(AgentRunProcessingServiceSource).not.toContain('this.runRetryCoordinator.createManualRerunFromUserMessage(input)');
    expect(sessionRunControlServiceSource).toContain('export class SessionRunControlService');
    expect(sessionRunControlServiceSource).toContain('cancelActiveSessionMessageRun({');
    expect(sessionRunControlServiceSource).toContain('cleanupInterruptedRunsOnStartup({');
  });

  it('keeps runtime event sequence and request metadata normalization in the events owner', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const terminalCoordinatorSource = readFileSync(join(repoRoot, 'packages/coding-agent/state/run-terminal-coordinator.ts'), 'utf8');
    const retryCoordinatorSource = readFileSync(join(repoRoot, 'packages/coding-agent/state/run-retry-coordinator.ts'), 'utf8');
    const eventLogSource = readFileSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-log.ts'), 'utf8');
    const eventPublisherSource = readFileSync(join(repoRoot, 'packages/coding-agent/events/runtime-event-publisher.ts'), 'utf8');

    expect(AgentRunProcessingServiceSource).toContain('private readonly runtimeEventLog: RuntimeEventLog');
    expect(AgentRunProcessingServiceSource).toContain('private readonly runtimeEventPublisher: RuntimeEventPublisher<ChatStreamEventAdapter>');
    expect(AgentRunProcessingServiceSource).not.toContain('withRequestMetadata(');
    expect(AgentRunProcessingServiceSource).not.toContain('withSequenceAfter(');
    expect(AgentRunProcessingServiceSource).not.toContain('withSessionMessageRequestMetadata(');
    expect(AgentRunProcessingServiceSource).not.toContain('onTerminalEvent:');
    expect(AgentRunProcessingServiceSource).not.toContain('private publishRunTerminalEventHooks');
    expect(AgentRunProcessingServiceSource).not.toContain('function nextRuntimeSequence');
    expect(terminalCoordinatorSource).not.toContain('function nextRuntimeSequence');
    expect(retryCoordinatorSource).not.toContain('function nextRuntimeSequence');
    expect(eventLogSource).toContain('export class RuntimeEventLog');
    expect(eventLogSource).toContain('export class RuntimeEventSequenceCursor');
    expect(eventPublisherSource).toContain('export class RuntimeEventPublisher');
    expect(eventPublisherSource).toContain('publishRunTerminalHooks');
  });

  it('keeps memory recall cwd resolution in the context owner', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');
    const initialModelInputPreparationSource = readFileSync(
      join(repoRoot, 'packages/coding-agent/agent-loop/initial-input/initial-model-input-preparation.ts'),
      'utf8',
    );
    const contextEffectiveCwdSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-input/effective-cwd.ts'), 'utf8');
    const modelInputContextBuilderSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/model-input/model-input-context-builder.ts'), 'utf8');

    expect(agentLoopSource).not.toContain('resolveMemoryRecallEffectiveCwd');
    expect(agentLoopSource).not.toContain('function resolveRecallEffectiveCwd');
    expect(agentLoopSource).not.toContain('const DEFAULT_CONTEXT_BUDGET_POLICY');
    expect(AgentRunProcessingServiceSource).not.toContain('function resolveRecallEffectiveCwd');
    expect(AgentRunProcessingServiceSource).not.toContain('const DEFAULT_CONTEXT_BUDGET_POLICY');
    expect(initialModelInputPreparationSource).toContain('resolveMemoryRecallEffectiveCwd');
    expect(initialModelInputPreparationSource).toContain('DEFAULT_CONTEXT_BUDGET_POLICY');
    expect(modelInputContextBuilderSource).toContain('export const DEFAULT_CONTEXT_BUDGET_POLICY');
    expect(contextEffectiveCwdSource).toContain('export function resolveMemoryRecallEffectiveCwd');
  });

  it('keeps ToolSet selection in the agent loop owner', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');
    const agentLoopSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/agent-loop.ts'), 'utf8');
    const toolsDefinitionsPath = join(repoRoot, 'packages/coding-agent/tools/definitions/model-visible-tool-definitions.ts');

    expect(existsSync(join(repoRoot, 'packages/coding-agent/obsolete-run/turn'))).toBe(false);
    expect(AgentRunProcessingServiceSource).not.toContain('prepareToolSet({');
    expect(AgentRunProcessingServiceSource).not.toContain('prepareToolRunner({');
    expect(AgentRunProcessingServiceSource).not.toContain('toolCallRunnerFactory.create');
    expect(AgentRunProcessingServiceSource).not.toContain('createToolRegistrySnapshotForCodingAgentRun');
    expect(AgentRunProcessingServiceSource).not.toContain('createToolRegistrySnapshotCreatedEvent');
    expect(agentLoopSource).toContain('export class ToolSetService');
    expect(agentLoopSource).toContain('export class AgentLoop');
    expect(agentLoopSource).toContain('prepareToolSet');
    expect(agentLoopSource).toContain('export async function prepareToolRunner');
    expect(agentLoopSource).toContain('getProviderCapabilitySummary');
    expect(agentLoopSource).toContain('listAvailableTools');
    expect(agentLoopSource).toContain('toolDefinitionFromRegisteredTool');
    expect(agentLoopSource).not.toContain('createRunSnapshot');
    expect(agentLoopSource).not.toContain('listDefinitions');
    expect(existsSync(toolsDefinitionsPath)).toBe(false);
  });

  it('wires the input runtime service through aggregate repository owner ports in session runtime composition', () => {
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
    expect(sessionRuntimeSource).not.toContain('inputProcessingRepositoryOptions');
    expect(sessionRuntimeSource).toContain('sessionRepository: options.sessionRepository');
    expect(sessionRuntimeSource).toContain('agentLoopRepository: options.agentLoopRepository');
    expect(sessionRuntimeSource).toContain('toolCallRepository: options.toolCallRepository');
    expect(runtimeSource).toContain('agentLoopRepository');
    expect(runtimeSource).not.toContain('sessionRunRepository: persistence.sessionRunRepository');
  });

  it('keeps default AgentRunProcessingService persistence composition outside the run service owner', () => {
    const AgentRunProcessingServiceSource = readFileSync(join(repoRoot, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'), 'utf8');

    expect(AgentRunProcessingServiceSource).not.toContain('sessionRunRepository');
    expect(AgentRunProcessingServiceSource).not.toContain('composeCodingAgentPersistence');
    expect(AgentRunProcessingServiceSource).not.toContain('createDefaultAgentRunRepositoryPort');
    expect(AgentRunProcessingServiceSource).not.toContain('createDefaultAgentRunProcessingService(');
    expect(AgentRunProcessingServiceSource).not.toContain('new PermissionSnapshotService');
    expect(AgentRunProcessingServiceSource).not.toContain('new PlanArtifactService');
    expect(AgentRunProcessingServiceSource).not.toContain('new ToolRegistrySnapshotService');
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
