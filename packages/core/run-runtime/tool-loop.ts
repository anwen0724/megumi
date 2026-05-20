import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent, TypedRuntimeEvent } from '@megumi/shared/runtime-events';
import { createToolResultCreatedEvent } from '@megumi/shared/runtime-event-factory';
import type { ToolResult, ToolUse } from '@megumi/shared/tool-contracts';
import type { AiModelStepPort } from '../ports/ai-port';
import { runModelStep } from './model-step';

export interface PendingToolApproval {
  approvalRequestId: string;
  toolUseId: string;
  reason: string;
}

export interface ToolUseHandlerOutcome {
  toolResults?: ToolResult[];
  pendingApprovals?: PendingToolApproval[];
}

export interface ToolUseHandlerPort {
  handleToolUses(input: {
    request: ModelStepRuntimeRequest;
    toolUses: ToolUse[];
    signal?: AbortSignal;
  }): Promise<ToolUseHandlerOutcome>;
}

export interface ModelToolLoopIds {
  nextEventId: () => string;
  nextStepId: () => string;
  nextModelStepId: () => string;
}

export interface RunModelToolLoopInput {
  initialRequest: ModelStepRuntimeRequest;
  aiPort: AiModelStepPort;
  toolUseHandler: ToolUseHandlerPort;
  ids: ModelToolLoopIds;
  signal?: AbortSignal;
  maxModelSteps?: number;
}

export async function* runModelToolLoop(input: RunModelToolLoopInput): AsyncIterable<RuntimeEvent> {
  const maxModelSteps = input.maxModelSteps ?? 8;
  let request = input.initialRequest;
  let sequenceOffset = 0;
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

    const outcome = await input.toolUseHandler.handleToolUses({
      request,
      toolUses,
      signal: input.signal,
    });

    if (outcome.pendingApprovals && outcome.pendingApprovals.length > 0) {
      return;
    }

    const toolResults = outcome.toolResults ?? [];

    for (const toolResult of toolResults) {
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

    if (toolResults.length === 0) {
      return;
    }

    accumulatedToolResults = [...accumulatedToolResults, ...toolResults];
    request = {
      ...request,
      stepId: input.ids.nextStepId(),
      modelStepId: input.ids.nextModelStepId(),
      toolResults: accumulatedToolResults,
      createdAt: new Date().toISOString(),
    };
  }

  throw new Error(`Model tool loop exceeded maxModelSteps (${maxModelSteps}).`);
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
  return event.eventType === 'tool.use.created';
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
