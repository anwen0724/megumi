// Guards the Coding Agent run mainline so the implementation stays readable from service to turn to loop.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function exists(relativePath: string): boolean {
  return existsSync(join(repoRoot, relativePath));
}

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function sourceFiles(relativePath: string): string[] {
  const absolute = join(repoRoot, relativePath);
  if (!existsSync(absolute)) return [];

  const stat = statSync(absolute);
  if (stat.isFile()) {
    return /\.(ts|tsx)$/.test(absolute) ? [absolute] : [];
  }

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative(repoRoot, child));
    return /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

function filesContaining(relativePath: string, predicate: (source: string) => boolean): string[] {
  return sourceFiles(relativePath)
    .filter((file) => predicate(readFileSync(file, 'utf8')))
    .map((file) => relative(repoRoot, file).replace(/\\/g, '/'));
}

describe('coding agent run mainline guards', () => {
  it('keeps obsolete run structure files removed and explicit replacements present', () => {
    expect(exists('packages/coding-agent/obsolete-run/tool-calls/tool-call-loop.ts')).toBe(false);
    expect(exists('packages/coding-agent/obsolete-run/lifecycle/run-state-repository.ts')).toBe(false);
    expect(exists('packages/coding-agent/obsolete-run/lifecycle')).toBe(false);
    expect(exists('packages/coding-agent/state/lifecycle/run-lifecycle.ts')).toBe(true);
  });

  it('keeps model-call independent from loop and tool-call internals', () => {
    const offenders = filesContaining('packages/coding-agent/agent-loop/model-call', (source) => {
      return /from ['"][^'"]*(\.\.\/loop|\.\.\/tool-calls\/(approval|execution|model-input))/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps the agent loop dependent only on the tool-call public boundary', () => {
    const offenders = filesContaining('packages/coding-agent/agent-loop/agent-loop.ts', (source) => {
      return /from ['"][^'"]*tool-call\/(approval|execution|model-input)/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps run internals from importing their own public barrel', () => {
    const offenders = filesContaining('packages/coding-agent/obsolete-run', (source) => {
      return /from ['"]@megumi\/coding-agent\/run['"]/.test(source)
        || /from ['"](?:\.\/|\.\.\/)index['"]/.test(source);
    }).filter((file) => !file.endsWith('/index.ts'));

    expect(offenders).toEqual([]);
  });

  it('keeps user input session creation in agent-run service without owning branch and timeline entrypoints', () => {
    const source = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const inputServiceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');

    for (const forbiddenImplementation of [
      'listTimelineMessagesBySession(',
      'createBranchDraft(',
      'cancelBranchDraft(',
    ]) {
      expect(source).not.toContain(forbiddenImplementation);
    }
    expect(inputServiceSource).toContain('sessionService.createSession({');
    expect(inputServiceSource).toContain('handleAgentRunInput');
    expect(inputServiceSource).toContain('submitUserInputToAgentLoop');
  });

  it('keeps session message input sensing in the input owner', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const inputSource = read('packages/coding-agent/agent-loop/services/agent-run-session-message.ts');

    expect(inputSource).toContain('export function prepareSessionMessageInput');
    expect(inputSource).toContain('export function parseSessionMessageRawInput');
    expect(inputSource).not.toContain('BUILT_IN_INPUT_COMMAND_REGISTRY');
    expect(serviceSource).not.toContain('BUILT_IN_INPUT_COMMAND_REGISTRY');
    expect(serviceSource).not.toContain('parseRawInput');
    expect(serviceSource).not.toContain('function currentUserChatMessage');
    expect(serviceSource).not.toContain('function findLastUserChatMessage');
  });

  it('keeps the run product port in host-interface instead of a run contract shell', () => {
    const AgentRunProcessingServicePort = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const inputServiceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const hostInterfaceSource = read('packages/coding-agent/host-interface/host-interface.ts');

    expect(exists('packages/coding-agent/agent-loop/agent-loop-operation.ts')).toBe(false);
    expect(exists('packages/coding-agent/agent-loop/agent-loop-operation-port.ts')).toBe(false);
    expect(exists('packages/coding-agent/obsolete-run/run-contract.ts')).toBe(false);
    expect(exists('packages/coding-agent/product-runtime')).toBe(false);
    expect(inputServiceSource).toContain('export interface UserInputHandlerPort');
    expect(hostInterfaceSource).toContain('input: InputController');
    expect(serviceSource).not.toContain('export interface AgentLoopOperationPort');
    expect(serviceSource).not.toContain('export interface AgentLoopOperationOptions');
    expect(serviceSource).not.toContain('export interface AgentLoopOperationIds');
  });

  it('keeps plan artifact read and update operations out of the run port', () => {
    const AgentRunProcessingServicePort = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const hostInterface = read('packages/coding-agent/host-interface/host-interface.ts');
    const runtimeComposition = read('packages/coding-agent/composition/compose-coding-agent-runtime.ts');
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const planArtifactService = read('packages/coding-agent/artifacts/plan-artifact-service.ts');

    expect(hostInterface).toContain('plan: PlanController');
    expect(runtimeComposition).toContain('plan: createPlanController(sessionRuntime.planArtifactService)');
    expect(planArtifactService).toContain('getPlanByRun(runId: string)');
    expect(planArtifactService).toContain('updatePlanStatus(input: PlanStatusUpdatePayload)');
    expect(AgentRunProcessingServicePort).not.toContain('getPlanByRun(');
    expect(AgentRunProcessingServicePort).not.toContain('updatePlanStatus(');
    expect(serviceSource).not.toContain('getPlanByRun(runId: string)');
    expect(serviceSource).not.toContain('updatePlanStatus(input: PlanStatusUpdatePayload)');
  });

  it('keeps permission snapshot creation details in the permissions owner', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const permissionsSource = read('packages/coding-agent/permissions/run-permission-snapshot.ts');

    expect(permissionsSource).toContain('export function createRunPermissionSnapshot');
    expect(permissionsSource).toContain('export function toModelPermissionSnapshot');
    expect(permissionsSource).toContain('createPermissionSnapshot(');
    expect(permissionsSource).toContain('linkAcceptedSourcePlan(');
    expect(serviceSource).toContain('createRunPermissionSnapshot({');
    expect(serviceSource).toContain('toModelPermissionSnapshot(');
    expect(serviceSource).not.toContain('createPermissionSnapshot({');
    expect(serviceSource).not.toContain('linkAcceptedSourcePlan({');
    expect(serviceSource).not.toContain('function createPermissionModeState');
    expect(serviceSource).not.toContain('function getRunStartPermissionModeState');
    expect(serviceSource).not.toContain('function toModelVisiblePermissionSnapshot');
    expect(serviceSource).not.toContain('isPermissionMode(');
  });

  it('keeps session message chat stream adapter creation in projections', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const submitInputOperationSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const chatStreamSource = read('packages/coding-agent/projections/chat-stream/chat-stream-event-adapter.ts');

    expect(chatStreamSource).toContain('export function createSessionMessageChatStreamAdapter');
    expect(submitInputOperationSource).toContain('createSessionMessageChatStreamAdapter({');
    expect(serviceSource).not.toContain('createChatStreamEventAdapter({');
    expect(serviceSource).not.toContain("streamKind: 'main'");
  });

  it('keeps manual retry and rerun lifecycle rules out of AgentRunProcessingService', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const retrySource = read('packages/coding-agent/state/run-retry-coordinator.ts');

    expect(retrySource).toContain('export class RunRetryCoordinator');
    expect(serviceSource).not.toContain('manualRetryReasonForRunStatus');
    expect(serviceSource).not.toContain('retryAttemptSourceRef');
  });

  it('keeps active session message run tracking in the state owner', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const stateSource = read('packages/coding-agent/state/active-session-message-runs.ts');

    expect(stateSource).toContain('export class ActiveSessionMessageRunTracker');
    expect(serviceSource).toContain('new ActiveSessionMessageRunTracker');
    expect(serviceSource).not.toContain('new Map<string, {');
    expect(serviceSource).not.toContain('private async *trackActiveSessionMessageRun');
  });

  it('keeps model call event persistence in the agent loop persistence owner', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const persistenceSource = read('packages/coding-agent/persistence/repos/agent-loop.repo.ts');

    expect(persistenceSource).toContain('recordModelCall');
    expect(serviceSource).not.toContain('private persistModelStepRecordFromEvent');
    expect(serviceSource).not.toContain('function getModelStepId');
  });

  it('keeps initial agent loop run startup in the state lifecycle owner', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const submitInputOperationSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const agentLoopSource = read('packages/coding-agent/agent-loop/agent-loop.ts');
    const approvalResumeGroupSource = read('packages/coding-agent/agent-loop/tool-call/approval/approval-resume-group.ts');
    const stateLifecycleSource = read('packages/coding-agent/state/lifecycle/run-lifecycle.ts');

    expect(stateLifecycleSource).toContain('export function startAgentLoopRun');
    expect(stateLifecycleSource).toContain('export function waitForAgentLoopApproval');
    expect(stateLifecycleSource).toContain('export function failAgentLoopBeforeModelCall');
    expect(stateLifecycleSource).toContain('export function completeAgentLoopModelCall');
    expect(stateLifecycleSource).toContain('export function failAgentLoopModelCall');
    expect(stateLifecycleSource).toContain('export function cancelAgentLoopModelCall');
    expect(submitInputOperationSource).toContain('startAgentLoopRun({');
    expect(serviceSource).toContain('failAgentLoopBeforeModelCall({');
    expect(serviceSource).not.toContain('waitForAgentLoopApproval({');
    expect(serviceSource).not.toContain('completeAgentLoopModelCall({');
    expect(serviceSource).not.toContain('failAgentLoopModelCall({');
    expect(serviceSource).not.toContain('cancelAgentLoopModelCall({');
    expect(approvalResumeGroupSource).toContain('waitForAgentLoopApproval({');
    expect(agentLoopSource).toContain('completeAgentLoopModelCall({');
    expect(agentLoopSource).toContain('failAgentLoopModelCall({');
    expect(agentLoopSource).toContain('cancelAgentLoopModelCall({');
    expect(serviceSource).not.toContain('private async *failRunBeforeModelStep');
    expect(serviceSource).not.toContain('private async *failRunBeforeModelCall');
    expect(serviceSource).not.toContain('const step = this.runExecutionFactRepository.saveStep({\n      stepId,\n      runId,');
    expect(serviceSource).not.toContain("assertRunStatusTransition(currentRun.status, 'waiting_for_approval')");
  });

  it('keeps initial model input memory recall adaptation in the context owner', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const contextSource = read('packages/coding-agent/agent-loop/initial-input/initial-model-input-preparation.ts');

    expect(contextSource).toContain('export function createAgentLoopInitialModelInputMemoryRecallService');
    expect(serviceSource).toContain('createAgentLoopInitialModelInputMemoryRecallService({');
    expect(serviceSource).not.toContain('private async recallMemoryForNewUserInput');
  });

  it('keeps memory enabled resolution in the settings owner', () => {
    const runServiceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const sessionServiceSource = read('packages/coding-agent/session/services/session-service.ts');
    const settingsSource = read('packages/coding-agent/settings/services/product-settings.ts');

    expect(settingsSource).toContain('export function resolveMemoryEnabled');
    expect(runServiceSource).toContain('resolveMemoryEnabled(this.memorySettingsProvider)');
    expect(sessionServiceSource).not.toContain('resolveMemoryEnabled');
    expect(runServiceSource).not.toContain('private resolveMemoryEnabled');
    expect(sessionServiceSource).not.toContain('private resolveMemoryEnabled');
  });

  it('keeps pending approval indexing in the agent-loop tool-call approval module', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const registrySource = read('packages/coding-agent/agent-loop/tool-call/approval/pending-approval-registry.ts');

    expect(registrySource).toContain('export class PendingApprovalRegistry');
    expect(serviceSource).toContain('PendingApprovalRegistry');
    expect(serviceSource).not.toContain('new Map<string, ApprovalResumeGroup>');
  });

  it('keeps model call context materialization split into focused part builders', () => {
    for (const requiredPath of [
      'packages/coding-agent/agent-loop/model-input/parts/runtime-constraints.ts',
      'packages/coding-agent/agent-loop/model-input/parts/instructions.ts',
      'packages/coding-agent/agent-loop/model-input/parts/session.ts',
      'packages/coding-agent/agent-loop/model-input/parts/input-preprocessing.ts',
      'packages/coding-agent/agent-loop/model-input/parts/memory.ts',
      'packages/coding-agent/agent-loop/model-input/parts/tool-result-model-input.ts',
      'packages/coding-agent/agent-loop/model-input/parts/provider-state.ts',
      'packages/coding-agent/agent-loop/model-input/parts/index.ts',
    ]) {
      expect(exists(requiredPath), requiredPath).toBe(true);
    }

    const contextSource = read('packages/coding-agent/agent-loop/model-input/model-call-context.ts');

    for (const movedImplementation of [
      'function instructionParts(',
      'function sessionInstructionParts(',
      'function inputPreprocessingInstructionParts(',
      'function memoryRecallParts(',
      'function runtimeConstraintParts(',
      'function toolResultModelInputParts(',
      'function providerStateSummary(',
    ]) {
      expect(contextSource).not.toContain(movedImplementation);
    }
  });

  it('keeps baseline run context session mapping in the context owner', () => {
    const serviceSource = read('packages/coding-agent/agent-loop/services/agent-run-service.ts');
    const runContextSource = read('packages/coding-agent/agent-loop/run-context/run-context-service.ts');

    expect(runContextSource).toContain('export function createBaselineContextForSession');
    expect(serviceSource).toContain('createBaselineContextForSession({');
    expect(serviceSource).not.toContain('private createInitialContextForRun');
    expect(serviceSource).not.toContain('private createInitialContextForSessionMessage');
    expect(serviceSource).not.toContain('const DEFAULT_MODEL_CAPABILITY_SUMMARY');
  });
});
