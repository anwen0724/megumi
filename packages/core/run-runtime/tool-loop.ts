import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent, TypedRuntimeEvent } from '@megumi/shared/runtime-events';
import { RuntimeEventSchema } from '@megumi/shared/runtime-event-schemas';
import {
  createRunFailedEvent,
  createToolResultCreatedEvent,
} from '@megumi/shared/runtime-event-factory';
import type { ApprovalRequest, ToolCall, ToolResult, ToolUse } from '@megumi/shared/tool-contracts';
import type { AiModelStepPort } from '../ports/ai-port';
import { runModelStep } from './model-step';

export interface PendingToolApproval {
  approvalRequest: ApprovalRequest;
  toolUse: ToolUse;
  toolCall: ToolCall;
}

export interface ToolUseHandlerOutcome {
  toolResults?: ToolResult[];
  pendingApprovals?: PendingToolApproval[];
  runtimeEvents?: RuntimeEvent[];
}

export interface ToolUseHandlerPort {
  handleToolUses(input: {
    request: ModelStepRuntimeRequest;
    toolUses: ToolUse[];
    signal?: AbortSignal;
  }): Promise<ToolUseHandlerOutcome>;
}

export interface ToolApprovalResumeInput {
  approvalRequestId: string;
  decision: 'approved' | 'denied';
  decidedAt: string;
  reason?: string;
}

export interface ToolApprovalResumeOutcome {
  toolResult: ToolResult;
  runtimeEvents?: RuntimeEvent[];
}

export interface ToolApprovalResumePort {
  resumeToolApproval(input: ToolApprovalResumeInput): Promise<ToolApprovalResumeOutcome | undefined>;
}

export interface PendingToolApprovalContinuation {
  pendingApproval: PendingToolApproval;
  request: ModelStepRuntimeRequest;
  accumulatedToolUses: ToolUse[];
  accumulatedToolResults: ToolResult[];
}

export interface ModelToolLoopIds {
  nextEventId: () => string;
  nextStepId: () => string;
  nextModelStepId: () => string;
}

export interface RunModelToolLoopInput {
  request: ModelStepRuntimeRequest;
  aiPort: AiModelStepPort;
  toolUseHandler: ToolUseHandlerPort;
  ids: ModelToolLoopIds;
  signal?: AbortSignal;
  maxModelSteps?: number;
  onPendingApproval?: (continuation: PendingToolApprovalContinuation) => void;
}

export async function* runModelToolLoop(input: RunModelToolLoopInput): AsyncIterable<RuntimeEvent> {
  const maxModelSteps = input.maxModelSteps ?? 8;
  let request = input.request;
  let sequenceOffset = 0;
  let accumulatedToolUses = [...(request.toolUses ?? [])];
  let accumulatedToolResults = [...(request.toolResults ?? [])];

  for (let modelStepCount = 0; modelStepCount < maxModelSteps; modelStepCount += 1) {
    const toolUses: ToolUse[] = [];
    let stepMaxSequence = sequenceOffset;

    for await (const event of runModelStep({
      request,
      aiPort: input.aiPort,
      signal: input.signal,
      eventIdFactory: input.ids.nextEventId,
    })) {
      const eventWithLoopSequence = {
        ...event,
        sequence: sequenceOffset + event.sequence,
      };
      stepMaxSequence = Math.max(stepMaxSequence, eventWithLoopSequence.sequence);

      if (isToolUseCreatedEvent(eventWithLoopSequence)) {
        toolUses.push(createToolUseFromEvent(eventWithLoopSequence));
      }

      yield eventWithLoopSequence;
    }

    sequenceOffset = stepMaxSequence;

    if (toolUses.length === 0) {
      return;
    }

    accumulatedToolUses = [...accumulatedToolUses, ...toolUses];

    const outcome = await input.toolUseHandler.handleToolUses({
      request,
      toolUses,
      signal: input.signal,
    });

    const toolResults = outcome.toolResults ?? [];
    const runtimeEvents = outcome.runtimeEvents ?? [];
    const hasPendingApprovals = Boolean(outcome.pendingApprovals && outcome.pendingApprovals.length > 0);

    for (const event of runtimeEvents) {
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

    const emittedToolResultIds = new Set(
      runtimeEvents
        .filter((event) => event.eventType === 'tool.result.created')
        .map((event) => {
          const payload = event.payload as { toolResultId?: unknown };
          return typeof payload.toolResultId === 'string' ? payload.toolResultId : undefined;
        })
        .filter((toolResultId): toolResultId is string => Boolean(toolResultId)),
    );

    for (const toolResult of toolResults) {
      if (emittedToolResultIds.has(String(toolResult.toolResultId))) {
        continue;
      }
      sequenceOffset += 1;
      yield createToolResultCreatedEvent({
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
          toolUseId: String(toolResult.toolUseId),
          ...(toolResult.toolCallId ? { toolCallId: String(toolResult.toolCallId) } : {}),
          kind: toolResult.kind,
          summary: createToolResultSummary(toolResult),
        },
      });
    }

    accumulatedToolResults = [...accumulatedToolResults, ...toolResults];

    if (hasPendingApprovals) {
      const continuationRequest: ModelStepRuntimeRequest = {
        ...request,
        toolUses: accumulatedToolUses,
        toolResults: accumulatedToolResults,
      };

      for (const pendingApproval of outcome.pendingApprovals ?? []) {
        input.onPendingApproval?.({
          pendingApproval,
          request: continuationRequest,
          accumulatedToolUses,
          accumulatedToolResults,
        });
      }
      return;
    }

    if (toolResults.length === 0) {
      return;
    }

    request = {
      ...request,
      stepId: input.ids.nextStepId(),
      modelStepId: input.ids.nextModelStepId(),
      toolUses: accumulatedToolUses,
      toolResults: accumulatedToolResults,
      createdAt: new Date().toISOString(),
    };
  }

  yield createRunFailedEvent({
    eventId: input.ids.nextEventId(),
    request: {
      requestId: request.requestId,
      sessionId: request.sessionId,
      providerId: request.providerId,
      modelId: request.modelId,
      messages: [],
      createdAt: request.createdAt,
      runtimeContext: request.runtimeContext,
    },
    runId: request.runId,
    sequence: sequenceOffset + 1,
    createdAt: new Date().toISOString(),
    error: {
      code: 'runtime_protocol_violation',
      message: `Model tool loop exceeded maxModelSteps (${maxModelSteps}).`,
      severity: 'error',
      retryable: false,
      source: 'core',
      details: {
        reason: 'runtime_loop_limit_exceeded',
        maxModelSteps,
      },
      debugId: request.runtimeContext?.debugId ?? `debug:${request.requestId}`,
    },
  });
}

function createToolUseFromEvent(event: TypedRuntimeEvent<'tool.use.created'>): ToolUse {
  return {
    toolUseId: event.payload.toolUseId,
    runId: String(event.runId),
    modelStepId: event.payload.modelStepId,
    providerToolUseId: event.payload.providerToolUseId,
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

function isToolUseCreatedEvent(event: RuntimeEvent): event is TypedRuntimeEvent<'tool.use.created'> {
  if (event.eventType !== 'tool.use.created') {
    return false;
  }

  return RuntimeEventSchema.safeParse(event).success;
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
