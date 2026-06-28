import type {
  ModelInputContext,
  ModelInputContextBuildRequest,
  ModelStepProviderState,
  ModelStepRuntimeRequest,
} from '@megumi/shared/model';
import type { PermissionMode } from '@megumi/shared/permission';
import type { RuntimeEvent, TypedRuntimeEvent } from '@megumi/shared/runtime';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import {
  createRunFailedEvent,
  createToolResultCreatedEvent,
} from '@megumi/shared/runtime';
import type { RunStep } from '@megumi/shared/session';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';
import {
  type BuildModelCallInputInput,
  type BuildModelCallInputResult,
  createModelCallInputContextId,
  type ModelInputMemoryRecallSource,
} from '../context';
import {
  coalesceTextDeltaRuntimeEvents,
  modelCallInputBuildFailureToRuntimeError,
} from '../events';
import { runModelCall, type ModelCallPort } from './model-call';
import { createTerminalRuntimeError } from '../state';
import type {
  PendingToolApprovalResume,
  ToolApprovalResumePort,
  ToolCallRunnerService,
  ToolResultModelInputBuildInput,
  ToolCallRunner,
} from './tool-call';
import {
  DEFAULT_MAX_MODEL_STEPS,
  DEFAULT_MAX_TOOL_ROUNDS,
} from './loop-limits';

export interface ModelToolLoopIds {
  nextEventId: () => string;
  nextStepId: () => string;
  nextModelStepId: () => string;
}

export interface RunModelToolLoopInput {
  request: ModelStepRuntimeRequest;
  modelCallPort: ModelCallPort;
  toolCallHandler: ToolCallRunner;
  ids: ModelToolLoopIds;
  signal?: AbortSignal;
  maxModelSteps?: number;
  maxToolRounds?: number;
  onPendingApproval?: (approvalResume: PendingToolApprovalResume) => void;
  onToolResultsSubmittedToModelInput?: (input: {
    request: ModelStepRuntimeRequest;
    toolResults: readonly ToolResult[];
    emittedAt: string;
  }) => readonly RuntimeEvent[] | void | Promise<readonly RuntimeEvent[] | void>;
  buildNextModelInputContext: (
    input: ToolResultModelInputBuildInput
  ) => ModelInputContext | Promise<ModelInputContext>;
}

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

export interface CodingAgentRunToolResultModelInputRecorder {
  markToolResultsSubmittedToModelInput(input: {
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
  toolResultModelInputRecorder?: CodingAgentRunToolResultModelInputRecorder;
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
  onPendingApproval?: (approvalResume: PendingToolApprovalResume) => void;
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
        onToolResultsSubmittedToModelInput: ({ request, toolResults, emittedAt }) => (
          input.ports.toolResultModelInputRecorder?.markToolResultsSubmittedToModelInput({
            request,
            stepId: request.stepId,
            toolResults,
            emittedAt,
            sequence: 0,
          }) ?? []
        ),
        buildNextModelInputContext: (contextInput) => buildNextModelInputContext({
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

export interface ApprovalResumeModelLoopInput {
  pendingRequest: ModelStepRuntimeRequest;
  resumedStep: RunStep;
  resumedInputContext: ModelInputContext;
  decidedAt: string;
  toolRuntime: ToolCallRunnerService;
  modelCallPort: ModelCallPort;
  modelCallInputBuildService: {
    buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
  };
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  ids: CodingAgentModelToolLoopStreamIds;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
}

export interface ApprovalResumeModelLoop {
  request: ModelStepRuntimeRequest;
  modelEvents: AsyncIterable<RuntimeEvent>;
  pendingApprovalResumes: PendingToolApprovalResume[];
}

export function streamApprovalResumeModelLoop(input: ApprovalResumeModelLoopInput): ApprovalResumeModelLoop {
  const request: ModelStepRuntimeRequest = {
    ...input.pendingRequest,
    stepId: input.resumedStep.stepId,
    modelStepId: input.ids.nextModelStepId(),
    inputContext: input.resumedInputContext,
    createdAt: input.decidedAt,
  };
  const pendingApprovalResumes: PendingToolApprovalResume[] = [];
  const modelEvents = streamCodingAgentModelToolLoop({
    request,
    ports: {
      modelCallPort: input.modelCallPort,
      toolCallHandler: input.toolRuntime,
      modelCallInputBuildService: input.modelCallInputBuildService,
      sourceOverrideProvider: input.sourceOverrideProvider,
      toolResultModelInputRecorder: {
        markToolResultsSubmittedToModelInput: ({ request, stepId, toolResults, emittedAt, sequence }) => {
          const event = input.toolRuntime.markToolResultsSubmittedToModelInput({
            request,
            stepId,
            toolResults,
            emittedAt,
            sequence,
          });
          return event ? [event] : [];
        },
      },
      ids: input.ids,
    },
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    permissionMode: input.permissionMode ?? 'default',
    memoryRecall: {
      ...(input.memoryRecall?.memoryRecallSources ? { memoryRecallSources: input.memoryRecall.memoryRecallSources } : {}),
      ...(input.memoryRecall?.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecall.memoryRecallSeed } : {}),
    },
    onPendingApproval: (pendingApprovalResume) => {
      pendingApprovalResumes.push(pendingApprovalResume);
    },
  });

  return { request, modelEvents, pendingApprovalResumes };
}

export async function* runModelToolLoop(input: RunModelToolLoopInput): AsyncIterable<RuntimeEvent> {
  const maxModelSteps = input.maxModelSteps ?? DEFAULT_MAX_MODEL_STEPS;
  const maxToolRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  let request = input.request;
  let sequenceOffset = 0;
  let toolRoundCount = 0;
  let accumulatedToolCalls: ToolCall[] = [];
  let accumulatedToolResults: ToolResult[] = [];
  let accumulatedProviderStates: ModelStepProviderState[] = [];

  for (let modelStepCount = 0; modelStepCount < maxModelSteps; modelStepCount += 1) {
    const toolCalls: ToolCall[] = [];
    const providerStates: ModelStepProviderState[] = [];
    let stepMaxSequence = sequenceOffset;

    for await (const event of runModelCall({
      request,
      modelCallPort: input.modelCallPort,
      signal: input.signal,
      eventIdFactory: input.ids.nextEventId,
    })) {
      const eventWithLoopSequence = {
        ...event,
        sequence: sequenceOffset + event.sequence,
      };
      stepMaxSequence = Math.max(stepMaxSequence, eventWithLoopSequence.sequence);

      if (isToolCallCreatedEvent(eventWithLoopSequence)) {
        toolCalls.push(createToolCallFromEvent(eventWithLoopSequence));
      }

      if (isModelStepProviderStateRecordedEvent(eventWithLoopSequence)) {
        providerStates.push(eventWithLoopSequence.payload);
      }

      yield eventWithLoopSequence;
    }

    sequenceOffset = stepMaxSequence;

    if (toolCalls.length === 0) {
      return;
    }

    toolRoundCount += 1;
    if (toolRoundCount > maxToolRounds) {
      yield createRunFailedEvent({
        eventId: input.ids.nextEventId(),
        request: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          providerId: request.providerId,
          modelId: request.modelId,
          runtimeContext: request.runtimeContext,
        },
        runId: request.runId,
        sequence: sequenceOffset + 1,
        createdAt: new Date().toISOString(),
        error: createTerminalRuntimeError({
          reason: 'loop_limit_exceeded',
          code: 'runtime_protocol_violation',
          message: `Model tool loop exceeded maxToolRounds (${maxToolRounds}).`,
          source: 'core',
          retryable: false,
          debugId: request.runtimeContext?.debugId ?? `debug:${request.requestId}`,
          details: { maxToolRounds },
        }),
      });
      return;
    }

    accumulatedToolCalls = [...accumulatedToolCalls, ...toolCalls];
    accumulatedProviderStates = [...accumulatedProviderStates, ...providerStates];

    const outcome = await input.toolCallHandler.handleToolCalls({
      request,
      toolCalls,
      signal: input.signal,
    });

    const toolResults = outcome.toolResults ?? [];
    const runtimeEvents = outcome.runtimeEvents ?? [];
    const hasPendingApprovals = Boolean(outcome.pendingApprovals && outcome.pendingApprovals.length > 0);
    const nextModelInputReady = outcome.nextModelInputReady ?? true;
    const normalizedRuntimeEvents: RuntimeEvent[] = [];

    for (const event of runtimeEvents) {
      sequenceOffset += 1;
      normalizedRuntimeEvents.push({
        ...event,
        runId: event.runId ?? request.runId,
        sessionId: event.sessionId ?? request.sessionId,
        stepId: event.stepId ?? request.stepId,
        requestId: event.requestId ?? request.requestId,
        ...(event.context ? { context: event.context } : request.runtimeContext ? { context: request.runtimeContext } : {}),
        sequence: sequenceOffset,
      });
    }

    const emittedToolResultIds = new Set(
      normalizedRuntimeEvents
        .filter((event) => event.eventType === 'tool.result.created')
        .map((event) => {
          const payload = event.payload as { toolResultId?: unknown };
          return typeof payload.toolResultId === 'string' ? payload.toolResultId : undefined;
        })
        .filter((toolResultId): toolResultId is string => Boolean(toolResultId)),
    );

    const toolResultEvents: RuntimeEvent[] = [];
    for (const toolResult of toolResults) {
      if (emittedToolResultIds.has(String(toolResult.toolResultId))) {
        continue;
      }
      sequenceOffset += 1;
      toolResultEvents.push(createToolResultCreatedEvent({
        eventId: input.ids.nextEventId(),
        eventType: 'tool.result.created',
        runId: request.runId,
        sessionId: request.sessionId,
        stepId: request.stepId,
        requestId: request.requestId,
        runtimeContext: request.runtimeContext,
        sequence: sequenceOffset,
        createdAt: toolResult.createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          toolResultId: String(toolResult.toolResultId),
          toolCallId: String(toolResult.toolCallId),
          ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
          kind: toolResult.kind,
          summary: toolResultEventSummary(toolResult),
        },
      }));
    }

    accumulatedToolResults = [...accumulatedToolResults, ...toolResults];

    if (hasPendingApprovals || !nextModelInputReady) {
      const nextModelRequest = await createNextModelCallRequest({
        request,
        stepId: request.stepId,
        ...(request.modelStepId ? { modelStepId: String(request.modelStepId) } : {}),
        createdAt: request.createdAt,
        contextKind: 'approval',
        accumulatedToolCalls,
        accumulatedToolResults,
        accumulatedProviderStates,
        buildNextModelInputContext: input.buildNextModelInputContext,
      });

      for (const pendingApproval of outcome.pendingApprovals ?? []) {
        input.onPendingApproval?.({
          pendingApproval,
          request: nextModelRequest,
          accumulatedToolCalls,
          accumulatedToolResults,
          accumulatedProviderStates,
        });
      }
      for (const event of normalizedRuntimeEvents) {
        yield event;
      }
      for (const event of toolResultEvents) {
        yield event;
      }
      return;
    }

    for (const event of normalizedRuntimeEvents) {
      yield event;
    }
    for (const event of toolResultEvents) {
      yield event;
    }

    if (toolResults.length === 0) {
      yield createRunFailedEvent({
        eventId: input.ids.nextEventId(),
        request: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          providerId: request.providerId,
          modelId: request.modelId,
          runtimeContext: request.runtimeContext,
        },
        runId: request.runId,
        sequence: sequenceOffset + 1,
        createdAt: new Date().toISOString(),
        error: createTerminalRuntimeError({
          reason: 'runtime_invariant_violation',
          code: 'runtime_protocol_violation',
          message: 'Tool calls were produced but no tool results or pending approvals were returned.',
          source: 'core',
          retryable: false,
          debugId: request.runtimeContext?.debugId ?? `debug:${request.requestId}`,
        }),
      });
      return;
    }

    const nextStepId = input.ids.nextStepId();
    const nextModelStepId = input.ids.nextModelStepId();
    const nextCreatedAt = new Date().toISOString();

    request = await createNextModelCallRequest({
      request,
      stepId: nextStepId,
      modelStepId: nextModelStepId,
      createdAt: nextCreatedAt,
      contextKind: 'tool-results',
      accumulatedToolCalls,
      accumulatedToolResults,
      accumulatedProviderStates,
      buildNextModelInputContext: input.buildNextModelInputContext,
    });
    const emittedEvents = await input.onToolResultsSubmittedToModelInput?.({
      request,
      toolResults,
      emittedAt: nextCreatedAt,
    }) ?? [];
    for (const event of emittedEvents) {
      sequenceOffset += 1;
      yield {
        ...event,
        runId: event.runId ?? request.runId,
        sessionId: event.sessionId ?? request.sessionId,
        stepId: event.stepId ?? request.stepId,
        requestId: event.requestId ?? request.requestId,
        ...(event.context ? { context: event.context } : request.runtimeContext ? { context: request.runtimeContext } : {}),
        sequence: sequenceOffset,
      };
    }
  }

  yield createRunFailedEvent({
    eventId: input.ids.nextEventId(),
    request: {
      requestId: request.requestId,
      sessionId: request.sessionId,
      providerId: request.providerId,
      modelId: request.modelId,
      runtimeContext: request.runtimeContext,
    },
    runId: request.runId,
    sequence: sequenceOffset + 1,
    createdAt: new Date().toISOString(),
    error: createTerminalRuntimeError({
      reason: 'loop_limit_exceeded',
      code: 'runtime_protocol_violation',
      message: `Model tool loop exceeded maxModelSteps (${maxModelSteps}).`,
      source: 'core',
      retryable: false,
      debugId: request.runtimeContext?.debugId ?? `debug:${request.requestId}`,
      details: { maxModelSteps },
    }),
  });
}

async function buildNextModelInputContext(input: {
  contextInput: ToolResultModelInputBuildInput;
  request: ModelStepRuntimeRequest;
  projectRoot?: string;
  permissionMode: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
  ports: CodingAgentModelToolLoopStreamPorts;
}): Promise<ModelInputContext> {
  const nextModelInput = await input.ports.modelCallInputBuildService.buildModelCallInput({
    baseInputContext: input.contextInput.baseInputContext,
    requestId: input.request.requestId,
    sessionId: input.contextInput.sessionId,
    runId: input.contextInput.runId,
    stepId: input.contextInput.stepId,
    contextKind: 'tool-results',
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

  if (nextModelInput.failure) {
    throw modelCallInputBuildFailureToRuntimeError(nextModelInput.failure);
  }

  return nextModelInput.inputContext;
}

async function createNextModelCallRequest(input: {
  request: ModelStepRuntimeRequest;
  stepId: string;
  modelStepId?: string;
  createdAt: string;
  contextKind: 'approval' | 'tool-results';
  accumulatedToolCalls: ToolCall[];
  accumulatedToolResults: ToolResult[];
  accumulatedProviderStates: ModelStepProviderState[];
  buildNextModelInputContext: (
    input: ToolResultModelInputBuildInput
  ) => ModelInputContext | Promise<ModelInputContext>;
}): Promise<ModelStepRuntimeRequest> {
  const contextInput = {
    contextId: createModelCallInputContextId({
      stepId: input.stepId,
      contextKind: input.contextKind,
    }),
    sessionId: input.request.sessionId,
    runId: String(input.request.runId),
    stepId: input.stepId,
    buildReason: 'tool_results_model_input',
    builtAt: input.createdAt,
    baseInputContext: input.request.inputContext,
    toolCalls: input.accumulatedToolCalls,
    toolResults: input.accumulatedToolResults,
    providerStates: input.accumulatedProviderStates,
  };

  return {
    ...input.request,
    stepId: input.stepId,
    ...(input.modelStepId ? { modelStepId: input.modelStepId } : {}),
    inputContext: await input.buildNextModelInputContext(contextInput),
    createdAt: input.createdAt,
  };
}

function createToolCallFromEvent(event: TypedRuntimeEvent<'tool.call.created'>): ToolCall {
  return {
    toolCallId: event.payload.toolCallId,
    runId: String(event.runId),
    modelStepId: event.payload.modelStepId,
    providerToolCallId: event.payload.providerToolCallId,
    toolName: event.payload.toolName,
    input: event.payload.input,
    inputPreview: {
      summary: event.payload.toolName,
      targets: [],
      redactionState: 'none',
    },
    status: 'created',
    createdAt: event.createdAt,
  };
}

function isToolCallCreatedEvent(event: RuntimeEvent): event is TypedRuntimeEvent<'tool.call.created'> {
  if (event.eventType !== 'tool.call.created') {
    return false;
  }

  return RuntimeEventSchema.safeParse(event).success;
}

function isModelStepProviderStateRecordedEvent(
  event: RuntimeEvent,
): event is TypedRuntimeEvent<'model.step.provider_state.recorded'> {
  if (event.eventType !== 'model.step.provider_state.recorded') {
    return false;
  }

  return RuntimeEventSchema.safeParse(event).success;
}

function toolResultEventSummary(toolResult: ToolResult): string {
  if (toolResult.textContent && toolResult.textContent.length > 0) {
    return toolResult.textContent;
  }

  if (toolResult.denialReason && toolResult.denialReason.length > 0) {
    return toolResult.denialReason;
  }

  if (toolResult.error) {
    return toolResult.error.message;
  }

  if (toolResult.structuredContent !== undefined) {
    return JSON.stringify(toolResult.structuredContent);
  }

  return toolResult.kind;
}
