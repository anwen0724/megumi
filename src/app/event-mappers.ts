// Maps Agent Runtime events into the entrypoint-neutral App event surface.
import type { AgentRuntimeEvent } from './agent-runtime-port';
import type { AppEvent } from './events';

export function mapAgentRuntimeEventToAppEvent(event: AgentRuntimeEvent): AppEvent {
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    source: 'agent',
    payload: {
      ...(event.runId ? { runId: event.runId } : {}),
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
      ...(event.payload ?? {}),
    },
  };
}
