import type {
  RunCancelledPayload,
  RunFailedPayload,
  RuntimeEvent,
  ToolExecutionApprovalRequestedPayload,
  ToolResultCreatedPayload,
} from '@megumi/shared/runtime';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { ApprovalRequest, ApprovalStatus, ToolExecution, ToolPolicyDecision } from '@megumi/shared/tool';
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

  if (event.eventType === 'tool.execution.requested') {
    const toolExecution = (event.payload as { toolExecution?: ToolExecution }).toolExecution;
    if (toolExecution) {
      store.upsertToolCall(toolExecution);
    }
  }

  if (event.eventType === 'tool.execution.policy_decided') {
    const payload = event.payload as { toolExecutionId: string; policyDecision: ToolPolicyDecision };
    const current = store.toolCallsById[payload.toolExecutionId];
    if (current) {
      store.upsertToolCall({ ...current, policyDecision: payload.policyDecision });
    }
  }

  if (event.eventType === 'tool.execution.approval_requested') {
    const payload = event.payload as ToolExecutionApprovalRequestedPayload & { toolExecution?: ToolExecution };
    const approvalRequestId = payload.approvalRequest.approvalRequestId;

    if (payload.toolExecution) {
      store.upsertToolCall({
        ...payload.toolExecution,
        approvalRequestId,
        status: 'pending_approval',
      });
    } else {
      const current = store.toolCallsById[payload.toolExecutionId];
      if (current) {
        store.upsertToolCall({
          ...current,
          approvalRequestId,
          status: 'pending_approval',
        });
      }
    }

    useApprovalStore.getState().upsertApprovalRequest(payload.approvalRequest);
  }

  if (event.eventType === 'tool.execution.started') {
    const payload = event.payload as { toolExecutionId: string; startedAt?: string };
    const current = store.toolCallsById[payload.toolExecutionId];
    if (current) {
      store.upsertToolCall({
        ...current,
        status: 'running',
        startedAt: payload.startedAt ?? event.createdAt,
      });
    }
    setAgentStatusForSession(targetSessionId, 'running');
  }

  if (event.eventType === 'tool.execution.completed') {
    const payload = event.payload as { toolExecutionId: string; completedAt?: string };
    const current = store.toolCallsById[payload.toolExecutionId];
    if (current) {
      store.upsertToolCall({
        ...current,
        status: 'completed',
        completedAt: payload.completedAt ?? event.createdAt,
      });
    }
  }

  if (event.eventType === 'tool.execution.failed') {
    const payload = event.payload as { toolExecutionId: string; error?: RuntimeError; completedAt?: string };
    const current = store.toolCallsById[payload.toolExecutionId];
    if (current) {
      store.upsertToolCall({
        ...current,
        status: 'failed',
        error: payload.error,
        completedAt: payload.completedAt ?? event.createdAt,
      });
    }
  }

  if (event.eventType === 'tool.execution.denied') {
    const payload = event.payload as { toolExecutionId: string; reason?: string };
    const current = store.toolCallsById[payload.toolExecutionId];
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

    const current = payload.toolExecutionId
      ? store.toolCallsById[payload.toolExecutionId]
      : store.findByToolCallId(payload.toolCallId);
    if (!current) {
      return;
    }

    const status = payload.kind === 'tool_error'
      ? 'failed'
      : payload.kind === 'policy_denied' || payload.kind === 'user_rejected'
        ? 'denied'
        : 'completed';

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

