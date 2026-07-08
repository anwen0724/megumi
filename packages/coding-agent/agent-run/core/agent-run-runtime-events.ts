/*
 * Creates RuntimeEvent envelopes for Agent Run.
 * This file does not translate legacy event names or normalize old payload shapes.
 */
import type {
  RuntimeEvent,
  RuntimeEventPayloadByType,
  RuntimeEventPersistMode,
  RuntimeEventSource,
  RuntimeEventType,
  RuntimeEventVisibility,
} from '../../events';
import type { AgentRun } from '../contracts/agent-run-contracts';

export type AgentRunRuntimeEventInput<TType extends RuntimeEventType = RuntimeEventType> = {
  eventType: TType;
  payload: RuntimeEventPayloadByType[TType];
  run?: Pick<AgentRun, 'run_id' | 'session_id'>;
  runId?: string;
  sessionId?: string;
  messageId?: string;
  requestId?: string;
  source?: RuntimeEventSource;
  visibility?: RuntimeEventVisibility;
  persist?: RuntimeEventPersistMode;
  createdAt?: string;
};

export type AgentRunRuntimeEventFactory = {
  emit<TType extends RuntimeEventType>(
    input: AgentRunRuntimeEventInput<TType>,
  ): RuntimeEvent<RuntimeEventPayloadByType[TType]>;
};

export function createAgentRunRuntimeEvent<TType extends RuntimeEventType>(input: {
  eventId: string;
  sequence: number;
  now: string;
  event: AgentRunRuntimeEventInput<TType>;
}): RuntimeEvent<RuntimeEventPayloadByType[TType]> {
  const runId = input.event.runId ?? input.event.run?.run_id;
  const sessionId = input.event.sessionId ?? input.event.run?.session_id;

  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.event.eventType,
    ...(runId ? { runId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(input.event.messageId ? { messageId: input.event.messageId } : {}),
    ...(input.event.requestId ? { requestId: input.event.requestId } : {}),
    sequence: input.sequence,
    createdAt: input.event.createdAt ?? input.now,
    source: input.event.source ?? 'core',
    visibility: input.event.visibility ?? 'user',
    persist: input.event.persist ?? 'required',
    payload: input.event.payload,
  };
}
