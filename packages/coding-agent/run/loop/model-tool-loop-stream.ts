// Bridges a turn's model-call request into the model/tool loop without leaking loop ownership into model-call.
import type { ModelInputContext, ModelInputContextBuildRequest, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { PermissionMode } from '@megumi/shared/permission';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ToolResult } from '@megumi/shared/tool';
import type {
  BuildModelCallInputInput,
  BuildModelCallInputResult,
  ModelInputMemoryRecallSource,
} from '../context';
import { coalesceTextDeltaRuntimeEvents, modelCallInputBuildFailureToRuntimeError } from '../../events';
import type { ModelCallPort } from '../model-call/model-call-contract';
import type {
  PendingToolApprovalContinuation,
  ToolApprovalResumePort,
  ToolCallRunner,
} from '../tool-calls/tool-call-contract';
import {
  runModelToolLoop,
  type ToolContinuationInputContextBuilderInput,
} from './agent-loop';

export interface CodingAgentRunSourceOverrideProvider {
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

export interface CodingAgentRunToolContinuationRecorder {
  markToolContinuationEmitted(input: {
    request: ModelStepRuntimeRequest;
    stepId: string;
    toolResults: readonly ToolResult[];
    emittedAt: string;
    sequence: number;
  }): readonly RuntimeEvent[] | undefined;
}

export interface CodingAgentModelToolLoopStreamIds {
  nextEventId(): string;
  nextStepId(input: { runId: string }): string;
  nextModelStepId(): string;
}

export interface CodingAgentModelToolLoopStreamPorts {
  modelCallPort: ModelCallPort;
  toolCallHandler?: ToolCallRunner & ToolApprovalResumePort;
  modelCallInputBuildService: {
    buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
  };
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  toolContinuationRecorder?: CodingAgentRunToolContinuationRecorder;
  ids: CodingAgentModelToolLoopStreamIds;
}

export interface CodingAgentModelToolLoopStreamInput {
  request: ModelStepRuntimeRequest;
  ports: CodingAgentModelToolLoopStreamPorts;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
  signal?: AbortSignal;
  onPendingApproval?: (continuation: PendingToolApprovalContinuation) => void;
}

export async function* streamCodingAgentModelToolLoop(
  input: CodingAgentModelToolLoopStreamInput,
): AsyncIterable<RuntimeEvent> {
  const modelEvents = input.ports.toolCallHandler
    ? runModelToolLoop({
        request: input.request,
        modelCallPort: input.ports.modelCallPort,
        toolCallHandler: input.ports.toolCallHandler,
        ids: {
          nextEventId: input.ports.ids.nextEventId,
          nextStepId: () => input.ports.ids.nextStepId({ runId: input.request.runId }),
          nextModelStepId: input.ports.ids.nextModelStepId,
        },
        signal: input.signal,
        onPendingApproval: input.onPendingApproval,
        onToolContinuationEmitted: ({ request, toolResults, emittedAt }) => (
          input.ports.toolContinuationRecorder?.markToolContinuationEmitted({
            request,
            stepId: request.stepId,
            toolResults,
            emittedAt,
            sequence: 0,
          }) ?? []
        ),
        buildContinuationInputContext: (contextInput) => buildContinuationInputContext({
          contextInput,
          request: input.request,
          projectRoot: input.projectRoot,
          permissionMode: input.permissionMode ?? 'default',
          memoryRecall: input.memoryRecall,
          ports: input.ports,
        }),
      })
    : input.ports.modelCallPort.streamModelCall({
        request: input.request,
        runId: input.request.runId,
        stepId: input.request.stepId,
        nextSequence: () => 1,
        eventIdFactory: input.ports.ids.nextEventId,
        signal: input.signal,
      });

  yield* coalesceTextDeltaRuntimeEvents(modelEvents);
}

async function buildContinuationInputContext(input: {
  contextInput: ToolContinuationInputContextBuilderInput;
  request: ModelStepRuntimeRequest;
  projectRoot?: string;
  permissionMode: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
  ports: CodingAgentModelToolLoopStreamPorts;
}): Promise<ModelInputContext> {
  const continuationInput = await input.ports.modelCallInputBuildService.buildModelCallInput({
    baseInputContext: input.contextInput.baseInputContext,
    requestId: input.request.requestId,
    sessionId: input.contextInput.sessionId,
    runId: input.contextInput.runId,
    stepId: input.contextInput.stepId,
    contextKind: 'tool-continuation',
    providerId: input.request.providerId,
    modelId: String(input.request.modelId),
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    ...input.ports.sourceOverrideProvider.resolveModelInputSourceOverrides({
      sessionId: input.contextInput.sessionId,
      runId: input.contextInput.runId,
      stepId: input.contextInput.stepId,
      builtAt: input.contextInput.builtAt,
    }),
    permissionMode: input.permissionMode,
    toolDefinitions: input.request.toolDefinitions ?? [],
    toolCalls: input.contextInput.toolCalls,
    toolResults: input.contextInput.toolResults,
    providerStates: input.contextInput.providerStates,
    ...(input.memoryRecall?.memoryRecallSources ? { memoryRecallSources: input.memoryRecall.memoryRecallSources } : {}),
    ...(input.memoryRecall?.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecall.memoryRecallSeed } : {}),
    builtAt: input.contextInput.builtAt,
  });

  if (continuationInput.failure) {
    throw modelCallInputBuildFailureToRuntimeError(continuationInput.failure);
  }

  return continuationInput.inputContext;
}
