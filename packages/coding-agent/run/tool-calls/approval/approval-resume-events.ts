// Builds runtime events emitted while resuming paused tool approvals.
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import {
  createRuntimeEvent,
  createToolResultCreatedEvent,
  type RuntimeEvent,
} from '@megumi/shared/runtime';
import type { RunStep } from '@megumi/shared/session';
import type { ApprovalScope, ToolResult } from '@megumi/shared/tool';
import {
  getToolResultEventId,
  withRequestMetadata,
  withSequenceAfter,
} from '../../events/runtime-event-metadata';
import type { ResumeToolApprovalOutcome } from '../tool-call-contract';

export interface ApprovalResumeEventIds {
  eventId(): string;
}

export function createApprovalResolvedRuntimeEvent(input: {
  request: ModelStepRuntimeRequest;
  stepId: RunStep['stepId'];
  sequence: number;
  approvalRequestId: string;
  decision: 'approved' | 'denied';
  scope: ApprovalScope;
  decidedAt: string;
  ids: ApprovalResumeEventIds;
}): RuntimeEvent {
  return withRequestMetadata(createRuntimeEvent({
    eventId: input.ids.eventId(),
    eventType: 'approval.resolved',
    runId: input.request.runId,
    sessionId: input.request.sessionId,
    stepId: String(input.stepId),
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.sequence,
    createdAt: input.decidedAt,
    source: 'approval',
    visibility: 'user',
    persist: 'required',
    payload: {
      approvalRequestId: input.approvalRequestId,
      decision: input.decision,
      scope: input.scope,
      decidedAt: input.decidedAt,
    },
  }), input.request);
}

export function persistResumeRuntimeEvents(input: {
  request: ModelStepRuntimeRequest;
  stepId: RunStep['stepId'];
  lastSequence: number;
  outcome: ResumeToolApprovalOutcome;
}): {
  events: RuntimeEvent[];
  lastSequence: number;
  toolResultIdsWithEvents: Set<string>;
} {
  let lastSequence = input.lastSequence;
  const events: RuntimeEvent[] = [];
  const toolResultIdsWithEvents = new Set<string>();

  for (const event of input.outcome.runtimeEvents ?? []) {
    const eventWithRequest = withSequenceAfter(withRequestMetadata({
      ...event,
      sessionId: event.sessionId ?? input.request.sessionId,
      stepId: event.stepId ?? String(input.stepId),
    }, input.request), lastSequence);
    lastSequence = eventWithRequest.sequence;
    if (eventWithRequest.eventType === 'tool.result.created') {
      const toolResultId = getToolResultEventId(eventWithRequest.payload);
      if (toolResultId) {
        toolResultIdsWithEvents.add(toolResultId);
      }
    }
    events.push(eventWithRequest);
  }

  return { events, lastSequence, toolResultIdsWithEvents };
}

export function createToolResultRuntimeEvent(input: {
  request: ModelStepRuntimeRequest;
  stepId: RunStep['stepId'];
  sequence: number;
  toolResult: ToolResult;
  ids: ApprovalResumeEventIds;
}): RuntimeEvent {
  return withRequestMetadata(createToolResultCreatedEvent({
    eventId: input.ids.eventId(),
    eventType: 'tool.result.created',
    runId: input.request.runId,
    sessionId: input.request.sessionId,
    stepId: String(input.stepId),
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.sequence,
    createdAt: input.toolResult.createdAt,
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolResultId: String(input.toolResult.toolResultId),
      toolCallId: String(input.toolResult.toolCallId),
      ...(input.toolResult.toolExecutionId ? { toolExecutionId: String(input.toolResult.toolExecutionId) } : {}),
      kind: input.toolResult.kind,
      summary: createToolResultSummary(input.toolResult),
    },
  }), input.request);
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
