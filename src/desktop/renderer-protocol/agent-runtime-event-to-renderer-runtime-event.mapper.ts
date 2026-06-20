// Projects Agent Runtime events into the renderer runtime protocol.
import type { AgentRuntimeEvent } from '../../app';
import type { RendererRuntimeEventDto } from '../../shared/renderer-contracts/renderer-api';
import { mapRendererApprovalRequest } from './productization.mapper';

export interface RendererRuntimeProjectionOptions {
  sequence?: number;
}

export function mapAgentRuntimeEventToRendererRuntimeEvent(
  event: AgentRuntimeEvent,
  options: RendererRuntimeProjectionOptions = {},
): RendererRuntimeEventDto | undefined {
  const payload = rendererPayloadOf(event);
  const sequence = readNumber(event.payload?.sequence) ?? readNumber(event.payload?.seq) ?? options.sequence ?? 1;
  const runId = event.runId ?? readString(event.payload?.runId) ?? 'default-run';
  const eventType = rendererEventTypeOf(event, payload);
  const sessionId = event.sessionId ?? readString(event.payload?.sessionId);
  const requestId = readString(event.payload?.requestId);
  const stepId = stepIdOf(event, payload);
  const projectId = event.workspaceId ?? readString(event.payload?.projectId) ?? readString(event.payload?.workspaceId);

  if (eventType === 'approval.requested') {
    const approvalRequest = readRecord(event.payload?.approvalRequest);
    if (!approvalRequest) return undefined;
    const rendererApproval = mapRendererApprovalRequest(approvalRequest as never, {
      runId,
      createdAt: event.occurredAt,
    });
    if (!rendererApproval) return undefined;
    return stripUndefinedFields({
      eventId: readString(event.payload?.eventId) ?? `runtime-event:${runId}:${sequence}`,
      eventType,
      projectId,
      runId,
      sessionId,
      requestId,
      stepId,
      sequence,
      createdAt: event.occurredAt,
      source: sourceOf(eventType),
      payload: { approvalRequest: rendererApproval },
    });
  }

  if (isTerminalRunEvent(eventType) && (!projectId || !sessionId || !requestId)) {
    return undefined;
  }

  return stripUndefinedFields({
    eventId: readString(event.payload?.eventId) ?? `runtime-event:${runId}:${sequence}`,
    eventType,
    projectId,
    runId,
    sessionId,
    requestId,
    stepId,
    sequence,
    createdAt: event.occurredAt,
    source: sourceOf(eventType),
    payload,
  });
}

function rendererPayloadOf(event: AgentRuntimeEvent): Record<string, unknown> {
  const payload = { ...(event.payload ?? {}) };
  delete payload.eventId;
  delete payload.runId;
  delete payload.sessionId;
  delete payload.seq;
  delete payload.sequence;

  if (event.workspaceId && !payload.workspaceId) {
    payload.workspaceId = event.workspaceId;
  }
  if (event.type === 'context.ready') {
    const included = readNumber(payload.included);
    const dropped = readNumber(payload.dropped);
    if (included !== undefined && payload.sourceCount === undefined) payload.sourceCount = included;
    if (dropped !== undefined && payload.droppedCount === undefined) payload.droppedCount = dropped;
  }
  if (event.type === 'run.status.changed') {
    const status = readString(payload.status) ?? readString(payload.to);
    if (status && payload.to === undefined) payload.to = normalizeRunStatus(status);
  }
  return payload;
}

function rendererEventTypeOf(event: AgentRuntimeEvent, payload: Record<string, unknown>): string {
  if (event.type === 'context.ready') return 'context.effective.updated';
  if (event.type === 'ai.message.completed') return 'assistant.output.completed';
  if (event.type === 'tool.call.created') return 'tool.execution.requested';
  if (event.type === 'tool.execution.completed') return toolExecutionCompletedEventType(payload);
  if (event.type === 'run.status.changed') {
    const status = normalizeRunStatus(readString(payload.status) ?? readString(payload.to));
    if (status === 'completed') return 'run.completed';
    if (status === 'failed') return 'run.failed';
    if (status === 'cancelled') return 'run.cancelled';
  }
  if (event.type === 'turn.started') return 'step.started';
  if (event.type === 'ai.message.event') return aiMessageRuntimeEventType(payload);
  return event.type;
}

function isTerminalRunEvent(eventType: string): boolean {
  return eventType === 'run.completed' || eventType === 'run.failed' || eventType === 'run.cancelled';
}

function toolExecutionCompletedEventType(payload: Record<string, unknown>): string {
  const status = readString(payload.status);
  if (status === 'failed' || status === 'error' || payload.isError === true || payload.error !== undefined) {
    return 'tool.execution.failed';
  }
  if (status === 'rejected' || status === 'denied' || status === 'user_rejected' || status === 'policy_denied') {
    return 'tool.execution.denied';
  }
  return 'tool.execution.completed';
}

function aiMessageRuntimeEventType(payload: Record<string, unknown>): string {
  const streamEvent = readRecord(payload.event);
  if (streamEvent?.type === 'content_block_delta') return 'assistant.output.delta';
  if (streamEvent?.type === 'content_block_stop') return 'assistant.output.completed';
  return 'assistant.output.event';
}

function stepIdOf(event: AgentRuntimeEvent, payload: Record<string, unknown>): string | undefined {
  const explicit = readString(payload.stepId);
  if (explicit) return explicit;
  if (event.type !== 'turn.started') return undefined;
  const turnIndex = readNumber(payload.turnIndex);
  return turnIndex === undefined ? `turn:${event.runId ?? 'default-run'}` : `turn:${turnIndex}`;
}

function sourceOf(eventType: string): string {
  if (eventType.startsWith('tool.')) return 'tool';
  if (eventType.startsWith('approval.')) return 'approval';
  if (eventType.startsWith('context.')) return 'core';
  if (eventType.startsWith('assistant.') || eventType.startsWith('model.')) return 'provider';
  return 'core';
}

function normalizeRunStatus(status: string | undefined): string | undefined {
  if (status === 'canceled') return 'cancelled';
  return status;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stripUndefinedFields(event: RendererRuntimeEventDto): RendererRuntimeEventDto {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined),
  ) as RendererRuntimeEventDto;
}
