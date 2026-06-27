import type {
  ModelInputContext,
  ModelInputContextPart,
  ModelInputContextPartBudget,
  ModelStepProviderState,
  ModelStepRuntimeRequest,
} from '@megumi/shared/model';
import type { RuntimeEvent, TypedRuntimeEvent } from '@megumi/shared/runtime';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import {
  createRunFailedEvent,
  createToolResultCreatedEvent,
} from '@megumi/shared/runtime';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';
import type { ModelCallPort } from '../model-call/model-call-contract';
import { runModelCall } from '../model-call/model-call-runner';
import { createTerminalRuntimeError } from '../lifecycle/run-state-policy';
import type {
  PendingToolApprovalContinuation,
  ToolCallRunner,
} from '../tool-calls/tool-call-contract';

const MODEL_INPUT_CONTEXT_ID_PREFIX = 'model-input-context:';
const MODEL_INPUT_CONTEXT_ID_MAX_LENGTH = 128;
const FALLBACK_CONTEXT_WINDOW = 128_000;
const FALLBACK_RESERVED_OUTPUT_TOKENS = 4_096;

function createAgentLoopModelInputContextId(input: { stepId: string; contextKind: string }): string {
  const suffix = `:${input.contextKind}`;
  const contextId = `${MODEL_INPUT_CONTEXT_ID_PREFIX}${input.stepId}${suffix}`;

  if (contextId.length <= MODEL_INPUT_CONTEXT_ID_MAX_LENGTH) {
    return contextId;
  }

  const availableStepIdLength = MODEL_INPUT_CONTEXT_ID_MAX_LENGTH
    - MODEL_INPUT_CONTEXT_ID_PREFIX.length
    - suffix.length;
  return `${MODEL_INPUT_CONTEXT_ID_PREFIX}${input.stepId.slice(0, Math.max(1, availableStepIdLength))}${suffix}`;
}

export interface ModelToolLoopIds {
  nextEventId: () => string;
  nextStepId: () => string;
  nextModelStepId: () => string;
}

export interface ToolContinuationInputContextBuilderInput {
  baseInputContext: ModelInputContext;
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  buildReason: string;
  builtAt: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  providerStates: ModelStepProviderState[];
}

export interface RunModelToolLoopInput {
  request: ModelStepRuntimeRequest;
  modelCallPort: ModelCallPort;
  toolCallHandler: ToolCallRunner;
  ids: ModelToolLoopIds;
  signal?: AbortSignal;
  maxModelSteps?: number;
  maxToolRounds?: number;
  onPendingApproval?: (continuation: PendingToolApprovalContinuation) => void;
  onToolContinuationEmitted?: (input: {
    request: ModelStepRuntimeRequest;
    toolResults: readonly ToolResult[];
    emittedAt: string;
  }) => readonly RuntimeEvent[] | void | Promise<readonly RuntimeEvent[] | void>;
  buildContinuationInputContext?: (
    input: ToolContinuationInputContextBuilderInput
  ) => ModelInputContext | Promise<ModelInputContext>;
}

export async function* runModelToolLoop(input: RunModelToolLoopInput): AsyncIterable<RuntimeEvent> {
  const maxModelSteps = input.maxModelSteps ?? 8;
  const maxToolRounds = input.maxToolRounds ?? maxModelSteps;
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
    const continuationReady = outcome.continuationReady ?? true;
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
          summary: createToolResultSummary(toolResult),
        },
      }));
    }

    accumulatedToolResults = [...accumulatedToolResults, ...toolResults];

    if (hasPendingApprovals || !continuationReady) {
      const continuationRequest = await createContinuationRequest({
        request,
        stepId: request.stepId,
        ...(request.modelStepId ? { modelStepId: String(request.modelStepId) } : {}),
        createdAt: request.createdAt,
        contextKind: 'approval',
        accumulatedToolCalls,
        accumulatedToolResults,
        accumulatedProviderStates,
        buildContinuationInputContext: input.buildContinuationInputContext,
      });

      for (const pendingApproval of outcome.pendingApprovals ?? []) {
        input.onPendingApproval?.({
          pendingApproval,
          request: continuationRequest,
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

    request = await createContinuationRequest({
      request,
      stepId: nextStepId,
      modelStepId: nextModelStepId,
      createdAt: nextCreatedAt,
      contextKind: 'continuation',
      accumulatedToolCalls,
      accumulatedToolResults,
      accumulatedProviderStates,
      buildContinuationInputContext: input.buildContinuationInputContext,
    });
    const emittedEvents = await input.onToolContinuationEmitted?.({
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

async function createContinuationRequest(input: {
  request: ModelStepRuntimeRequest;
  stepId: string;
  modelStepId?: string;
  createdAt: string;
  contextKind: 'approval' | 'continuation';
  accumulatedToolCalls: ToolCall[];
  accumulatedToolResults: ToolResult[];
  accumulatedProviderStates: ModelStepProviderState[];
  buildContinuationInputContext?: (
    input: ToolContinuationInputContextBuilderInput
  ) => ModelInputContext | Promise<ModelInputContext>;
}): Promise<ModelStepRuntimeRequest> {
  const contextInput = {
    contextId: createAgentLoopModelInputContextId({
      stepId: input.stepId,
      contextKind: input.contextKind,
    }),
    sessionId: input.request.sessionId,
    runId: String(input.request.runId),
    stepId: input.stepId,
    buildReason: 'tool_continuation',
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
    inputContext: input.buildContinuationInputContext
      ? await input.buildContinuationInputContext(contextInput)
      : buildFallbackToolContinuationInputContext(contextInput),
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

function buildFallbackToolContinuationInputContext(input: ToolContinuationInputContextBuilderInput): ModelInputContext {
  const inheritedParts = input.baseInputContext.parts.filter((part) => part.kind !== 'tool_continuation');
  const continuationParts = [
    ...input.toolCalls.map((toolCall, index): ModelInputContextPart => ({
      partId: `part:tool-call:${index + 1}:${toolCall.toolCallId}`,
      kind: 'tool_continuation',
      text: `Tool call ${toolCall.toolCallId} requested ${toolCall.toolName}. Input preview: ${toolCall.inputPreview.summary}.`,
      toolCallId: String(toolCall.toolCallId),
      providerToolCallId: toolCall.providerToolCallId,
      modelStepId: String(toolCall.modelStepId),
      toolName: toolCall.toolName,
      toolInput: toolCall.input,
      sourceRefs: [{
        sourceId: `tool-call:${toolCall.toolCallId}`,
        sourceKind: 'tool_call',
        sourceUri: `tool-call://${toolCall.toolCallId}`,
        loadedAt: toolCall.createdAt ?? input.builtAt,
        metadata: {
          toolName: toolCall.toolName,
          status: toolCall.status,
        },
      }],
      priority: 80,
      budgetStatus: 'included_full',
      budgetClass: 'continuation',
      metadata: {
        toolName: toolCall.toolName,
        status: toolCall.status,
      },
    })),
    ...input.toolResults.map((toolResult, index): ModelInputContextPart => ({
      partId: `part:tool-result:${index + 1}:${toolResult.toolResultId}`,
      kind: 'tool_continuation',
      text: `Tool result ${toolResult.toolResultId} for ${toolResult.toolCallId}: ${createToolResultSummary(toolResult)}.`,
      toolCallId: String(toolResult.toolCallId),
      ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
      toolResultId: String(toolResult.toolResultId),
      toolResultContent: createToolResultSummary(toolResult),
      sourceRefs: [{
        sourceId: `tool-result:${toolResult.toolResultId}`,
        sourceKind: 'tool_result',
        sourceUri: `tool-result://${toolResult.toolResultId}`,
        loadedAt: toolResult.createdAt,
        metadata: {
          kind: toolResult.kind,
          redactionState: toolResult.redactionState,
        },
      }],
      priority: 85,
      budgetStatus: 'included_full',
      budgetClass: 'continuation',
      metadata: {
        kind: toolResult.kind,
        redactionState: toolResult.redactionState,
      },
    })),
    ...input.providerStates.map((providerState, index): ModelInputContextPart => ({
      partId: `part:provider-state:${index + 1}:${providerState.modelStepId}`,
      kind: 'tool_continuation',
      text: createProviderStateSummary(providerState),
      modelStepId: String(providerState.modelStepId),
      providerStateIds: [`${providerState.modelStepId}:${index}`],
      providerStateText: createProviderStateSummary(providerState),
      sourceRefs: [{
        sourceId: `provider-state:${providerState.modelStepId}:${index}`,
        sourceKind: 'provider_state',
        sourceUri: `provider-state://${providerState.modelStepId}/${index}`,
        loadedAt: input.builtAt,
        metadata: {
          providerId: providerState.providerId,
          modelId: providerState.modelId,
        },
      }],
      priority: 75,
      budgetStatus: 'included_full',
      budgetClass: 'continuation',
    })),
  ];
  const parts = [...inheritedParts, ...continuationParts];
  const partBudgets = parts.map((part): ModelInputContextPartBudget => ({
    partId: part.partId,
    tokenEstimate: estimateTextTokens(textForPart(part)),
    budgetStatus: part.budgetStatus,
  }));
  const inputTokenEstimate = partBudgets.reduce((total, partBudget) => total + partBudget.tokenEstimate, 0);
  const modelContextWindow = input.baseInputContext.budget.modelContextWindow || FALLBACK_CONTEXT_WINDOW;
  const reservedOutputTokens = input.baseInputContext.budget.reservedOutputTokens || FALLBACK_RESERVED_OUTPUT_TOKENS;

  return {
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    builtAt: input.builtAt,
    parts,
    budget: {
      modelContextWindow,
      reservedOutputTokens,
      availableInputTokens: Math.max(0, modelContextWindow - reservedOutputTokens),
      keepRecentTokens: input.baseInputContext.budget.keepRecentTokens,
      inputTokenEstimate,
      partBudgets,
    },
    trace: {
      buildReason: input.buildReason,
      selectedSources: parts.flatMap((part) =>
        part.sourceRefs.map((sourceRef) => ({
          sourceId: sourceRef.sourceId,
          sourceKind: sourceRef.sourceKind,
          reason: part.kind === 'tool_continuation' ? 'tool_continuation' : 'base_context',
          partId: part.partId,
          ...(part.budgetClass ? { budgetClass: part.budgetClass } : {}),
        })),
      ),
      excludedSources: [],
      metadata: {
        fallbackBuilder: 'agent-loop',
      },
    },
  };
}

function textForPart(part: ModelInputContextPart): string {
  return 'text' in part ? part.text : '';
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function createProviderStateSummary(providerState: ModelStepProviderState): string {
  const blocks = providerState.blocks.map((block) => {
    switch (block.type) {
      case 'reasoning_content':
      case 'thinking':
        return block.text;
      case 'redacted_thinking':
        return '[redacted thinking omitted]';
    }
  }).filter(Boolean);

  return blocks.length > 0
    ? blocks.join('\n')
    : `Provider state recorded for ${providerState.modelStepId}.`;
}

function createToolResultSummary(toolResult: ToolResult): string {
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
