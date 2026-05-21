import type {
  AssistantOutputCompletedPayload,
  AssistantOutputDeltaPayload,
  RunCancelledPayload,
  RunFailedPayload,
  RuntimeEvent,
} from '@megumi/shared/runtime-events';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { ApprovalRequest, ApprovalStatus, ToolCall, ToolPolicyDecision } from '@megumi/shared/tool-contracts';
import { useApprovalStore } from '../../entities/approval';
import { useChatStore } from '../../entities/chat/store';
import type { TimelineMessageData } from '../../entities/chat/types';
import { useRunStore } from '../../entities/run/store';
import { useToolCallStore } from '../../entities/tool-call';

const completedContentsByRun = new Map<string, string>();

function createMessage(role: TimelineMessageData['role'], content: string): TimelineMessageData {
  const now = new Date().toISOString();
  return {
    id: `message-${role}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: now,
  };
}

function hasRuntimeEventAlreadyBeenDispatched(event: RuntimeEvent): boolean {
  if (!event.runId) {
    return false;
  }

  const events = useRunStore.getState().eventsByRun[event.runId] ?? [];
  return events.some((item) => item.eventId === event.eventId || item.sequence === event.sequence);
}

function applyToolEvent(event: RuntimeEvent): void {
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
    useChatStore.getState().setAgentStatus('running');
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
}

function applyApprovalEvent(event: RuntimeEvent): void {
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
    useChatStore.getState().setAgentStatus('running');
  }
}

export function dispatchRuntimeEvent(event: RuntimeEvent): void {
  const alreadyDispatched = hasRuntimeEventAlreadyBeenDispatched(event);
  useRunStore.getState().applyRuntimeEvent(event);

  if (!event.runId || alreadyDispatched) {
    return;
  }

  applyToolEvent(event);
  applyApprovalEvent(event);

  const chatState = useChatStore.getState();

  if (event.eventType === 'run.started') {
    chatState.setAgentStatus('running');
    return;
  }

  if (event.eventType === 'run.status.changed') {
    const to = (event.payload as { to?: string }).to;
    if (to === 'waiting_for_approval') {
      chatState.setAgentStatus('waiting-approval');
    }
    if (to === 'running') {
      chatState.setAgentStatus('running');
    }
    return;
  }

  if (event.eventType === 'assistant.output.delta') {
    chatState.appendStreamToken((event.payload as AssistantOutputDeltaPayload).delta);
    return;
  }

  if (event.eventType === 'assistant.output.completed') {
    completedContentsByRun.set(event.runId, (event.payload as AssistantOutputCompletedPayload).content);
    return;
  }

  if (event.eventType === 'run.completed') {
    const state = useChatStore.getState();
    const completedContent = completedContentsByRun.get(event.runId)?.trim();
    const assistantContent = completedContent || state.streamingText.trim() || 'Done.';
    completedContentsByRun.delete(event.runId);
    state.commitStream(createMessage('assistant', assistantContent));
    return;
  }

  if (event.eventType === 'run.failed') {
    const payload = event.payload as RunFailedPayload;
    const message = payload.error.message;
    chatState.addMessage(createMessage('assistant', message));
    chatState.clearStream();
    chatState.setAgentStatus('error');
    chatState.setLastError(message);
    completedContentsByRun.delete(event.runId);
    return;
  }

  if (event.eventType === 'run.cancelled') {
    const payload = event.payload as RunCancelledPayload;
    const reason = payload.reason ?? payload.error?.message ?? 'Session message was cancelled.';
    chatState.addMessage(createMessage('assistant', reason));
    chatState.clearStream();
    chatState.setLastError(reason);
    completedContentsByRun.delete(event.runId);
  }
}
