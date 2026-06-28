// Normalizes runtime event request metadata and sequence numbers across run modules.
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';

export function getToolResultEventId(payload: RuntimeEvent['payload']): string | undefined {
  if (!isObjectRecord(payload)) {
    return undefined;
  }

  return typeof payload.toolResultId === 'string' ? payload.toolResultId : undefined;
}

export function withRequestMetadata(event: RuntimeEvent, request: ModelStepRuntimeRequest): RuntimeEvent {
  return {
    ...event,
    requestId: event.requestId ?? request.requestId,
    ...(event.context ? { context: event.context } : request.runtimeContext ? { context: request.runtimeContext } : {}),
  };
}

export function withSessionMessageRequestMetadata(
  event: RuntimeEvent,
  input: {
    requestId: string;
    runtimeContext?: RuntimeContext;
  },
): RuntimeEvent {
  return {
    ...event,
    requestId: event.requestId ?? input.requestId,
    ...(event.context ? { context: event.context } : input.runtimeContext ? { context: input.runtimeContext } : {}),
  };
}

export function withSequenceAfter(event: RuntimeEvent, lastSequence: number): RuntimeEvent {
  if (event.sequence > lastSequence) {
    return event;
  }

  return {
    ...event,
    sequence: lastSequence + 1,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
