import type { AnyEvent } from '@megumi/product-host/host';
import { useChatUiStore, type RunUiStatus } from '../../entities/chat-ui/store';
import { useRunStore } from '../../entities/run/store';
import { useSessionStore } from '../../entities/session/store';
import { useToolCallStore } from '../../entities/tool-call';
import { useSessionTimelineStore } from '../session-timeline/session-timeline-store';

export interface DispatchRuntimeEventOptions {
  sessionId?: string | null;
  projectId?: string;
  projectTimeline?: boolean;
}

function hasRuntimeEventAlreadyBeenDispatched(event: AnyEvent): boolean {
  if (!event.executionId) {
    return false;
  }

  const events = useRunStore.getState().eventsByRun[event.executionId] ?? [];
  return events.some((item) => item.id === event.id);
}

function resolveEventSessionId(event: AnyEvent, options?: DispatchRuntimeEventOptions): string | null {
  return options?.sessionId ?? event.sessionId ?? useSessionStore.getState().activeSessionId;
}

function syncActiveChatUiSession(sessionId: string | null): void {
  if (sessionId && sessionId === useSessionStore.getState().activeSessionId) {
    useChatUiStore.getState().setActiveSession(sessionId);
  }
}

function setAgentStatusForSession(sessionId: string | null, agentStatus: RunUiStatus): void {
  syncActiveChatUiSession(sessionId);
  useChatUiStore.getState().setAgentStatus(agentStatus, sessionId);
}

function setLastErrorForSession(sessionId: string | null, lastError: string | null): void {
  syncActiveChatUiSession(sessionId);
  useChatUiStore.getState().setLastError(lastError, sessionId);
}

function applyToolEvent(event: AnyEvent, targetSessionId: string | null): void {
  const store = useToolCallStore.getState();

  if (event.type === 'tool_execution.requested') {
    // The model asked for the tool: create the entry immediately with its name
    // and arguments; started/settled events fill in the rest.
    const payload = event.payload;
    const existing = store.findByToolCallId(payload.toolCallId);
    store.upsertToolCall({
      ...existing,
      toolCallId: payload.toolCallId,
      executionId: event.executionId ?? existing?.executionId ?? '',
      toolName: payload.toolName,
      status: existing?.status ?? 'created',
      requestedAt: existing?.requestedAt ?? event.createdAt,
      input: payload.args,
    });
    return;
  }

  if (event.type === 'tool_execution.started') {
    const payload = event.payload;
    const existing = store.findByToolCallId(payload.toolCallId);
    store.upsertToolCall({
      ...existing,
      toolCallId: payload.toolCallId,
      executionId: event.executionId ?? existing?.executionId ?? '',
      toolName: payload.toolName,
      status: 'running',
      requestedAt: existing?.requestedAt ?? event.createdAt,
      input: payload.args,
      startedAt: event.createdAt,
    });
    setAgentStatusForSession(targetSessionId, 'running');
  }

  if (event.type === 'tool_execution.ended') {
    const payload = event.payload;
    const current = store.findByToolCallId(payload.toolCallId);
    if (current) {
      store.upsertToolCall({
        ...current,
        status: payload.status === 'completed'
          ? 'succeeded'
          : payload.status === 'cancelled'
            ? 'cancelled'
            : payload.status === 'denied'
              ? 'rejected'
              : 'failed',
        error: payload.error,
        resultPreview: payload.status === 'completed'
          ? typeof payload.result === 'string' ? payload.result : payload.result
          : undefined,
        completedAt: event.createdAt,
      });
    }
  }
}

/**
 * Routes one Runtime Event to Desktop-owned presentation stores. Timeline
 * projection happens before Run-only routing so Session activities are kept.
 */
export function dispatchRuntimeEvent(event: AnyEvent, options?: DispatchRuntimeEventOptions): void {
  const targetSessionId = resolveEventSessionId(event, options);

  const alreadyDispatched = hasRuntimeEventAlreadyBeenDispatched(event);
  useRunStore.getState().applyRuntimeEvent(event);

  if (options?.projectTimeline !== false && options?.projectId) {
    useSessionTimelineStore.getState().applyRuntimeEvent(options.projectId, event);
  }

  if (!event.executionId || alreadyDispatched) {
    return;
  }
  applyToolEvent(event, targetSessionId);
  if (event.type === 'approval.resolved') setAgentStatusForSession(targetSessionId, 'running');

  if (event.type === 'approval.requested') {
    setAgentStatusForSession(targetSessionId, 'waiting-approval');
    return;
  }

  if (event.type === 'run.started') {
    setAgentStatusForSession(targetSessionId, 'running');
    setLastErrorForSession(targetSessionId, null);
    return;
  }

  if (event.type === 'run.ended') {
    const payload = event.payload;
    if (payload.status === 'completed') {
      setAgentStatusForSession(targetSessionId, 'idle');
      setLastErrorForSession(targetSessionId, null);
    } else if (payload.status === 'failed') {
      setAgentStatusForSession(targetSessionId, 'error');
      setLastErrorForSession(targetSessionId, payload.error?.message ?? 'Run failed.');
    } else {
      setAgentStatusForSession(targetSessionId, 'idle');
      setLastErrorForSession(targetSessionId, 'Session message was cancelled.');
    }
  }
}
