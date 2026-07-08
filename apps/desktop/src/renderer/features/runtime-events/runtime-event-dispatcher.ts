import type {
  RunCancelledPayload,
  RunFailedPayload,
  RuntimeEvent,
  AgentRunToolResultCreatedPayload,
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallRequestedPayload,
  ToolCallStartedPayload,
} from '@megumi/coding-agent/events';
import type { ApprovalRequest, ApprovalStatus } from '../../entities/approval/store';
import { useApprovalStore } from '../../entities/approval';
import { useChatUiStore, type AgentRunStatus } from '../../entities/chat-ui/store';
import { useRunStore } from '../../entities/run/store';
import { useSessionStore } from '../../entities/session/store';
import { useToolCallStore } from '../../entities/tool-call';
import { useRuntimeTimelineStore } from '../runtime-timeline';

interface DispatchRuntimeEventOptions {
  sessionId?: string | null;
}

function hasRuntimeEventAlreadyBeenDispatched(event: RuntimeEvent): boolean {
  if (!event.runId) {
    return false;
  }

  const events = useRunStore.getState().eventsByRun[event.runId] ?? [];
  return events.some((item) => item.eventId === event.eventId || item.sequence === event.sequence);
}

function resolveEventSessionId(event: RuntimeEvent, options?: DispatchRuntimeEventOptions): string | null {
  return options?.sessionId ?? event.sessionId ?? useSessionStore.getState().activeSessionId;
}

function syncActiveChatUiSession(sessionId: string | null): void {
  if (sessionId && sessionId === useSessionStore.getState().activeSessionId) {
    useChatUiStore.getState().setActiveSession(sessionId);
  }
}

function setAgentStatusForSession(sessionId: string | null, agentStatus: AgentRunStatus): void {
  syncActiveChatUiSession(sessionId);
  useChatUiStore.getState().setAgentStatus(agentStatus, sessionId);
}

function setLastErrorForSession(sessionId: string | null, lastError: string | null): void {
  syncActiveChatUiSession(sessionId);
  useChatUiStore.getState().setLastError(lastError, sessionId);
}

function applyToolEvent(event: RuntimeEvent, targetSessionId: string | null): void {
  const store = useToolCallStore.getState();

  if (event.eventType === 'tool_call.requested') {
    const payload = event.payload as ToolCallRequestedPayload;
    const existing = store.findByToolCallId(payload.toolCallId);
    store.upsertToolCall({
      toolExecutionId: existing?.toolExecutionId ?? payload.toolCallId,
      toolCallId: payload.toolCallId,
      runId: event.runId ?? '',
      toolName: payload.toolName,
      status: 'created',
      requestedAt: event.createdAt,
      input: payload.input,
    });
  }

  if (event.eventType === 'tool_call.started') {
    const payload = event.payload as ToolCallStartedPayload;
    const existing = store.findByToolCallId(payload.toolCallId);
    store.upsertToolCall({
      ...existing,
      toolExecutionId: payload.toolExecutionId,
      toolCallId: payload.toolCallId,
      runId: event.runId ?? existing?.runId ?? '',
      toolName: payload.toolName,
      status: 'running',
      requestedAt: existing?.requestedAt ?? event.createdAt,
      input: payload.input,
      startedAt: event.createdAt,
    });
    setAgentStatusForSession(targetSessionId, 'running');
  }

  if (event.eventType === 'tool_call.completed') {
    const payload = event.payload as ToolCallCompletedPayload;
    const current = payload.toolExecutionId
      ? store.toolCallsById[payload.toolExecutionId]
      : store.findByToolCallId(payload.toolCallId);
    if (current) {
      store.upsertToolCall({
        ...current,
        toolName: payload.toolName,
        status: 'succeeded',
        completedAt: event.createdAt,
      });
    }
  }

  if (event.eventType === 'tool_call.failed') {
    const payload = event.payload as ToolCallFailedPayload;
    const current = payload.toolExecutionId
      ? store.toolCallsById[payload.toolExecutionId]
      : store.findByToolCallId(payload.toolCallId);
    if (current) {
      store.upsertToolCall({
        ...current,
        toolName: payload.toolName,
        status: 'failed',
        error: payload.error,
        completedAt: event.createdAt,
      });
    }
  }

  if (event.eventType === 'tool_result.created') {
    const payload = event.payload as AgentRunToolResultCreatedPayload;
    if (!payload.toolCallId) {
      return;
    }

    const current = payload.toolExecutionId
      ? store.toolCallsById[payload.toolExecutionId]
      : store.findByToolCallId(payload.toolCallId);
    if (!current) {
      return;
    }

    const status = payload.kind === 'failed'
      ? 'failed'
      : payload.kind === 'policy_denied' || payload.kind === 'user_rejected'
        ? 'rejected'
        : 'succeeded';

    store.upsertToolCall({
      ...current,
      status,
      resultPreview: payload.summary,
      completedAt: event.createdAt,
    });
  }
}

function applyApprovalEvent(event: RuntimeEvent, targetSessionId: string | null): void {
  const store = useApprovalStore.getState();

  if (event.eventType === 'approval.requested') {
    const request = (event.payload as { approvalRequest?: ApprovalRequest }).approvalRequest;
    if (request) {
      store.upsertApprovalRequest(request);
    }
  }

  if (event.eventType === 'approval.resolved') {
    const payload = event.payload as {
      approvalRequestId: string;
      decision: Exclude<ApprovalStatus, 'pending'>;
      decidedAt?: string;
    };
    store.markResolved(payload.approvalRequestId, payload.decision, payload.decidedAt ?? event.createdAt);
    setAgentStatusForSession(targetSessionId, 'running');
  }
}

export function dispatchRuntimeEvent(event: RuntimeEvent, options?: DispatchRuntimeEventOptions): void {
  const targetSessionId = resolveEventSessionId(event, options);

  if (event.eventType === 'assistant.output.delta' || event.eventType === 'model.output.delta') {
    return;
  }

  const alreadyDispatched = hasRuntimeEventAlreadyBeenDispatched(event);
  useRunStore.getState().applyRuntimeEvent(event);

  if (!event.runId || alreadyDispatched) {
    return;
  }

  useRuntimeTimelineStore.getState().dispatch(event);
  applyToolEvent(event, targetSessionId);
  applyApprovalEvent(event, targetSessionId);

  if (event.eventType === 'run.started') {
    setAgentStatusForSession(targetSessionId, 'running');
    setLastErrorForSession(targetSessionId, null);
    return;
  }

  if (event.eventType === 'run.status.changed') {
    const to = (event.payload as { to?: string }).to;
    if (to === 'waiting_for_approval') {
      setAgentStatusForSession(targetSessionId, 'waiting-approval');
    }
    if (to === 'running') {
      setAgentStatusForSession(targetSessionId, 'running');
    }
    return;
  }

  if (event.eventType === 'run.completed') {
    setAgentStatusForSession(targetSessionId, 'idle');
    setLastErrorForSession(targetSessionId, null);
    return;
  }

  if (event.eventType === 'run.failed') {
    const payload = event.payload as RunFailedPayload;
    setAgentStatusForSession(targetSessionId, 'error');
    setLastErrorForSession(targetSessionId, payload.error.message);
    return;
  }

  if (event.eventType === 'run.cancelled') {
    const payload = event.payload as RunCancelledPayload;
    const reason = payload.reason ?? payload.error?.message ?? 'Session message was cancelled.';
    setAgentStatusForSession(targetSessionId, 'idle');
    setLastErrorForSession(targetSessionId, reason);
  }
}
