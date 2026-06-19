// Maps App events into renderer chat stream events.
import type { AppEvent } from '../../app';
import type { RendererChatStreamEventDto } from '../dto/renderer-api';

export function mapAppEventToChatStreamEvent(event: AppEvent): RendererChatStreamEventDto | undefined {
  if (!event.type.startsWith('run.') && !event.type.startsWith('ai.') && !event.type.startsWith('tool.')) {
    return undefined;
  }
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    sessionId: typeof event.payload.sessionId === 'string' ? event.payload.sessionId : undefined,
    runId: typeof event.payload.runId === 'string' ? event.payload.runId : undefined,
    payload: event.payload,
  };
}
