// Streams one Coding Agent model step through the generic Agent Runtime while product context stays in coding-agent.
import {
  runModelToolLoop,
  type ToolContinuationInputContextBuilderInput,
} from '../loop';
import type { ModelStepPort } from './model-call-contract';
import type {
  PendingToolApprovalContinuation,
  ToolApprovalResumePort,
  ToolCallHandlerPort,
} from '../tool-calls/tool-call-contract';
import type { ModelInputContext, ModelInputContextBuildRequest, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { PermissionMode } from '@megumi/shared/permission';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ToolResult } from '@megumi/shared/tool';
import { mapModelCallToAiInput } from './model-call-request-mapper';
import { adaptAssistantStreamToRuntimeEvents } from './model-event-adapter';
import { systemClock, type Clock, type ModelCallAdapterRequest } from './model-call-contract';
import type {
  BuildModelStepInputInput,
  BuildModelStepInputResult,
  ModelInputMemoryRecallSource,
} from '../context';
import { coalesceTextDeltaRuntimeEvents, modelStepInputBuildFailureToRuntimeError } from '../events/runtime-event-utils';

export async function* streamModelCall(input: {
  request: ModelCallAdapterRequest;
  clock?: Clock;
}): AsyncIterable<RuntimeEvent> {
  const aiInput = mapModelCallToAiInput({
    request: input.request.request,
    config: input.request.config,
  });
  const stream = input.request.aiClient.stream({
    model: aiInput.model,
    context: aiInput.context,
    toolSet: aiInput.toolSet,
    signal: input.request.signal,
    credential: { type: 'api_key', value: input.request.config.apiKey },
  });

  yield* adaptAssistantStreamToRuntimeEvents({
    request: input.request,
    stream,
    clock: input.clock ?? systemClock,
  });
}

export interface CodingAgentRunSourceOverrideProvider {
  resolveModelInputSourceOverrides(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): Partial<Pick<
    BuildModelStepInputInput,
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

export interface CodingAgentModelStepStreamIds {
  nextEventId(): string;
  nextStepId(input: { runId: string }): string;
  nextModelStepId(): string;
}

export interface CodingAgentModelStepStreamPorts {
  modelStepPort: ModelStepPort;
  toolCallHandler?: ToolCallHandlerPort & ToolApprovalResumePort;
  modelStepInputBuildService: {
    buildModelStepInput(input: BuildModelStepInputInput): Promise<BuildModelStepInputResult>;
  };
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  toolContinuationRecorder?: CodingAgentRunToolContinuationRecorder;
  ids: CodingAgentModelStepStreamIds;
}

export interface CodingAgentModelStepStreamInput {
  request: ModelStepRuntimeRequest;
  ports: CodingAgentModelStepStreamPorts;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
  signal?: AbortSignal;
  onPendingApproval?: (continuation: PendingToolApprovalContinuation) => void;
}

export async function* streamCodingAgentModelStep(
  input: CodingAgentModelStepStreamInput,
): AsyncIterable<RuntimeEvent> {
  const modelEvents = input.ports.toolCallHandler
    ? runModelToolLoop({
        request: input.request,
        modelStepPort: input.ports.modelStepPort,
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
    : input.ports.modelStepPort.streamModelStep({
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
  ports: CodingAgentModelStepStreamPorts;
}): Promise<ModelInputContext> {
  const continuationInput = await input.ports.modelStepInputBuildService.buildModelStepInput({
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
    throw modelStepInputBuildFailureToRuntimeError(continuationInput.failure);
  }

  return continuationInput.inputContext;
}
