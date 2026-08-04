import type { AnyEvent } from '@megumi/product/host';
import { useChatUiStore, type RunUiStatus } from '../../entities/chat-ui/store';
import { useRunStore } from '../../entities/run/store';
import { useSessionStore } from '../../entities/session/store';
import { useToolCallStore } from '../../entities/tool-call';
import { useRuntimeTimelineStore } from '../runtime-timeline';

interface DispatchRuntimeEventOptions {
  sessionId?: string | null;
  projectTimeline?: boolean;
}

function hasRuntimeEventAlreadyBeenDispatched(event: AnyEvent): boolean {
  if (!event.runId) {
    return false;
  }

  const events = useRunStore.getState().eventsByRun[event.runId] ?? [];
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

  if (event.type === 'tool_execution.started') {
    const payload = event.payload;
    const existing = store.findByToolCallId(payload.toolCallId);
    store.upsertToolCall({
      ...existing,
      toolCallId: payload.toolCallId,
      runId: event.runId ?? existing?.runId ?? '',
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

export function dispatchRuntimeEvent(event: AnyEvent, options?: DispatchRuntimeEventOptions): void {
  const targetSessionId = resolveEventSessionId(event, options);

  const alreadyDispatched = hasRuntimeEventAlreadyBeenDispatched(event);
  useRunStore.getState().applyRuntimeEvent(event);

  if (!event.runId || alreadyDispatched) {
    return;
  }

  if (options?.projectTimeline !== false) {
    useRuntimeTimelineStore.getState().dispatch(event);
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
