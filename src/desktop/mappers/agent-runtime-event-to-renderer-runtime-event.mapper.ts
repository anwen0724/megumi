// Projects Agent Runtime events into the renderer runtime event DTO.
import type { AgentRuntimeEvent } from '../../app';
import type { RendererRuntimeEventDto } from '../dto/renderer-api';

export function mapAgentRuntimeEventToRendererRuntimeEvent(event: AgentRuntimeEvent): RendererRuntimeEventDto {
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    payload: {
      ...(event.payload ?? {}),
      ...(event.runId ? { runId: event.runId } : {}),
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    },
  };
}
