import type {
  RunCancelledPayload,
  RunFailedPayload,
  RuntimeEvent,
  ToolCallApprovalRequestedPayload,
  ToolResultCreatedPayload,
} from '@megumi/shared/runtime-events';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { ApprovalRequest, ApprovalStatus, ToolCall, ToolPolicyDecision } from '@megumi/shared/tool-contracts';
import { useApprovalStore } from '../../entities/approval';
import { useChatUiStore, type AgentRunStatus } from '../../entities/chat-ui/store';
import { useRunStore } from '../../entities/run/store';
import { useSessionStore } from '../../entities/session/store';
import { useToolCallStore } from '../../entities/tool-call';

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

function shouldProjectUiStatus(sessionId: string | null): boolean {
  return !sessionId || sessionId === useSessionStore.getState().activeSessionId;
}

function setAgentStatusForSession(sessionId: string | null, agentStatus: AgentRunStatus): void {
  if (shouldProjectUiStatus(sessionId)) {
    useChatUiStore.getState().setAgentStatus(agentStatus);
  }
}

function setLastErrorForSession(sessionId: string | null, lastError: string | null): void {
  if (shouldProjectUiStatus(sessionId)) {
    useChatUiStore.getState().setLastError(lastError);
  }
}

function applyToolEvent(event: RuntimeEvent, targetSessionId: string | null): void {
  const store = useToolCallStore.getState();

  if (event.eventType === 'tool.call.requested') {
    const toolCall = (event.payload as { toolCall?: ToolCall }).toolCall;
    if (toolCall) {
      store.upsertToolCall(toolCall);
    }
  }

  if (event.eventType === 'tool.call.policy_decided') {
    const payload = event.payload as { toolCallId: string; policyDecision: ToolPolicyDecision };
    const current = store.toolCallsById[payload.toolCallId];
    if (current) {
      store.upsertToolCall({ ...current, policyDecision: payload.policyDecision });
    }
  }

  if (event.eventType === 'tool.call.approval_requested') {
    const payload = event.payload as ToolCallApprovalRequestedPayload & { toolCall?: ToolCall };
    const approvalRequestId = payload.approvalRequest.approvalRequestId;

    if (payload.toolCall) {
      store.upsertToolCall({
        ...payload.toolCall,
        approvalRequestId,
        status: 'waiting_for_approval',
      });
    } else {
      const current = store.toolCallsById[payload.toolCallId];
      if (current) {
        store.upsertToolCall({
          ...current,
          approvalRequestId,
          status: 'waiting_for_approval',
        });
      }
    }

    useApprovalStore.getState().upsertApprovalRequest(payload.approvalRequest);
  }

  if (event.eventType === 'tool.call.started') {
    const payload = event.payload as { toolCallId: string; startedAt?: string };
    const current = store.toolCallsById[payload.toolCallId];
    if (current) {
      store.upsertToolCall({
        ...current,
        status: 'running',
        startedAt: payload.startedAt ?? event.createdAt,
      });
    }
    setAgentStatusForSession(targetSessionId, 'running');
  }

  if (event.eventType === 'tool.call.completed') {
    const payload = event.payload as { toolCallId: string; completedAt?: string };
    const current = store.toolCallsById[payload.toolCallId];
    if (current) {
      store.upsertToolCall({
        ...current,
        status: 'succeeded',
        completedAt: payload.completedAt ?? event.createdAt,
      });
    }
  }

  if (event.eventType === 'tool.call.failed') {
    const payload = event.payload as { toolCallId: string; error?: RuntimeError; completedAt?: string };
    const current = store.toolCallsById[payload.toolCallId];
    if (current) {
      store.upsertToolCall({
        ...current,
        status: 'failed',
        error: payload.error,
        completedAt: payload.completedAt ?? event.createdAt,
      });
    }
  }

  if (event.eventType === 'tool.call.denied') {
    const payload = event.payload as { toolCallId: string; reason?: string };
    const current = store.toolCallsById[payload.toolCallId];
    if (current) {
      store.upsertToolCall({
        ...current,
        status: 'denied',
        error: {
          code: 'approval_denied',
          message: payload.reason ?? 'Tool call was denied.',
          severity: 'info',
          retryable: false,
          source: 'approval',
        },
        completedAt: event.createdAt,
      });
    }
  }

  if (event.eventType === 'tool.result.created') {
    const payload = event.payload as ToolResultCreatedPayload;
    if (!payload.toolCallId) {
      return;
    }

    const current = store.toolCallsById[payload.toolCallId];
    if (!current) {
      return;
    }

    const status = payload.kind === 'tool_error'
      ? 'failed'
      : payload.kind === 'policy_denied' || payload.kind === 'user_rejected'
        ? 'denied'
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
