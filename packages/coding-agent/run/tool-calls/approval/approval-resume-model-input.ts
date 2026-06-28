// Prepares model input for continuing a run after approval resumes tool results.
import type { PermissionMode } from '@megumi/shared/permission';
import type { RunStep } from '@megumi/shared/session';
import type { ToolResult } from '@megumi/shared/tool';
import type {
  BuildModelCallInputInput,
  BuildModelCallInputResult,
  ModelInputMemoryRecallSource,
} from '../../../context';
import type { PendingToolApprovalContinuation } from '../tool-call-contract';

export interface ApprovalResumeModelInputRepositoryPort {
  saveStep(step: RunStep): RunStep;
}

export interface ApprovalResumeModelInputBuildService {
  buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
}

export interface ApprovalResumeModelInputSourceOverrideProvider {
  resolveModelInputSourceOverrides(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): Partial<Pick<
    BuildModelCallInputInput,
    'globalInstructionDirs' | 'sessionInstructionSources' | 'requestedCwd'
  >>;
}

export interface ApprovalResumeModelInputIds {
  stepId(): string;
}

export async function prepareApprovalResumeModelInput(input: {
  pending: PendingToolApprovalContinuation;
  resolvedResults: readonly ToolResult[];
  decidedAt: string;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: BuildModelCallInputInput['memoryRecallSeed'];
  repository: ApprovalResumeModelInputRepositoryPort;
  modelCallInputBuildService: ApprovalResumeModelInputBuildService;
  sourceOverrideProvider: ApprovalResumeModelInputSourceOverrideProvider;
  ids: ApprovalResumeModelInputIds;
}): Promise<{
  step: RunStep;
  toolResults: ToolResult[];
  modelInput: BuildModelCallInputResult;
}> {
  const step = input.repository.saveStep({
    stepId: input.ids.stepId(),
    runId: input.pending.request.runId,
    kind: 'model',
    status: 'running',
    title: 'Model response',
    startedAt: input.decidedAt,
  });
  const toolResults = [
    ...input.pending.accumulatedToolResults,
    ...input.resolvedResults,
  ];
  const stepId = String(step.stepId);
  const runId = String(input.pending.request.runId);

  const modelInput = await input.modelCallInputBuildService.buildModelCallInput({
    baseInputContext: input.pending.request.inputContext,
    requestId: input.pending.request.requestId,
    sessionId: input.pending.request.sessionId,
    runId,
    stepId,
    contextKind: 'approval-resume',
    providerId: input.pending.request.providerId,
    modelId: String(input.pending.request.modelId),
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    ...input.sourceOverrideProvider.resolveModelInputSourceOverrides({
      sessionId: input.pending.request.sessionId,
      runId,
      stepId,
      builtAt: input.decidedAt,
    }),
    permissionMode: input.permissionMode ?? 'default',
    toolDefinitions: input.pending.request.toolDefinitions ?? [],
    toolCalls: input.pending.accumulatedToolCalls,
    toolResults,
    providerStates: input.pending.accumulatedProviderStates,
    ...(input.memoryRecallSources ? { memoryRecallSources: input.memoryRecallSources } : {}),
    ...(input.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecallSeed } : {}),
    builtAt: input.decidedAt,
  });

  return { step, toolResults, modelInput };
}
