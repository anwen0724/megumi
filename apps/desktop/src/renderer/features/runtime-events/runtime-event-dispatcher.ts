import type {
  AssistantOutputCompletedPayload,
  AssistantOutputDeltaPayload,
  ModelOutputDeltaPayload,
  RunCancelledPayload,
  RunFailedPayload,
  RuntimeEvent,
  ToolCallApprovalRequestedPayload,
  ToolResultCreatedPayload,
} from '@megumi/shared/runtime-events';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { ApprovalRequest, ApprovalStatus, ToolCall, ToolPolicyDecision } from '@megumi/shared/tool-contracts';
import { useApprovalStore } from '../../entities/approval';
import { type AgentRunStatus, type ChatSnapshot, useChatStore } from '../../entities/chat/store';
import type { TimelineMessageData } from '../../entities/chat/types';
import { useRunStore } from '../../entities/run/store';
import { useSessionStore } from '../../entities/session/store';
import { useToolCallStore } from '../../entities/tool-call';

const completedContentsByRun = new Map<string, string>();
const dispatchedTextDeltaEvents = new Set<string>();
const STREAM_OUTPUT_FLUSH_DELAY_MS = 32;
const bufferedStreamOutputsByRun = new Map<string, {
  output: string;
  sessionId: string | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
}>();

interface DispatchRuntimeEventOptions {
  sessionId?: string | null;
}

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

function textDeltaDispatchKey(event: RuntimeEvent): string {
  return `${event.runId ?? 'no-run'}:${event.eventId}:${event.sequence}`;
}

function hasTextDeltaAlreadyBeenDispatched(event: RuntimeEvent): boolean {
  const key = textDeltaDispatchKey(event);
  if (dispatchedTextDeltaEvents.has(key)) {
    return true;
  }
  dispatchedTextDeltaEvents.add(key);
  return false;
}

function clearTextDeltaDispatchKeysForRun(runId: string): void {
  for (const key of dispatchedTextDeltaEvents) {
    if (key.startsWith(`${runId}:`)) {
      dispatchedTextDeltaEvents.delete(key);
    }
  }
}

function emptyChatSnapshot(): ChatSnapshot {
  return {
    messages: [],
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    completedToolActivities: [],
    agentStatus: 'idle',
    lastError: null,
  };
}

function snapshotFromCurrentState(state: ReturnType<typeof useChatStore.getState>): ChatSnapshot {
  return {
    messages: state.messages,
    streamingText: state.streamingText,
    isStreaming: state.isStreaming,
    pendingToolCalls: state.pendingToolCalls,
    completedToolActivities: state.completedToolActivities,
    agentStatus: state.agentStatus,
    lastError: state.lastError,
  };
}

function resolveEventSessionId(event: RuntimeEvent, options?: DispatchRuntimeEventOptions): string | null {
  return options?.sessionId ?? event.sessionId ?? useSessionStore.getState().activeSessionId;
}

function updateChatForSession(
  sessionId: string | null,
  updater: (snapshot: ChatSnapshot) => ChatSnapshot,
): void {
  const activeSessionId = useSessionStore.getState().activeSessionId;

  useChatStore.setState((state) => {
    if (!sessionId || sessionId === activeSessionId) {
      const updated = updater(snapshotFromCurrentState(state));
      return {
        messages: updated.messages,
        streamingText: updated.streamingText,
        isStreaming: updated.isStreaming,
        pendingToolCalls: updated.pendingToolCalls,
        completedToolActivities: updated.completedToolActivities,
        agentStatus: updated.agentStatus,
        lastError: updated.lastError,
      };
    }

    const currentSnapshot = state.sessionSnapshots[sessionId] ?? emptyChatSnapshot();
    return {
      sessionSnapshots: {
        ...state.sessionSnapshots,
        [sessionId]: updater(currentSnapshot),
      },
    };
  });
}

function appendStreamTokenForSession(sessionId: string | null, token: string): void {
  updateChatForSession(sessionId, (snapshot) => ({
    ...snapshot,
    streamingText: snapshot.streamingText + token,
    isStreaming: true,
    agentStatus: 'running',
  }));
}

function commitStreamForSession(sessionId: string | null, message: TimelineMessageData): void {
  updateChatForSession(sessionId, (snapshot) => ({
    ...snapshot,
    messages: [...snapshot.messages, message],
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    agentStatus: 'idle',
    lastError: null,
  }));
}

function addMessageForSession(sessionId: string | null, message: TimelineMessageData): void {
  updateChatForSession(sessionId, (snapshot) => ({
    ...snapshot,
    messages: [...snapshot.messages, message],
  }));
}

function clearStreamForSession(sessionId: string | null): void {
  updateChatForSession(sessionId, (snapshot) => ({
    ...snapshot,
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    agentStatus: 'idle',
    lastError: null,
  }));
}

function setAgentStatusForSession(sessionId: string | null, agentStatus: AgentRunStatus): void {
  updateChatForSession(sessionId, (snapshot) => ({
    ...snapshot,
    agentStatus,
  }));
}

function setLastErrorForSession(sessionId: string | null, lastError: string | null): void {
  updateChatForSession(sessionId, (snapshot) => ({
    ...snapshot,
    lastError,
  }));
}

function streamingTextForSession(sessionId: string | null): string {
  const state = useChatStore.getState();
  const activeSessionId = useSessionStore.getState().activeSessionId;

  if (!sessionId || sessionId === activeSessionId) {
    return state.streamingText;
  }

  return state.sessionSnapshots[sessionId]?.streamingText ?? '';
}

function flushBufferedStreamOutput(runId: string): void {
  const buffer = bufferedStreamOutputsByRun.get(runId);
  if (!buffer?.output) {
    return;
  }

  const output = buffer.output;
  bufferedStreamOutputsByRun.set(runId, {
    ...buffer,
    output: '',
  });
  appendStreamTokenForSession(buffer.sessionId, output);
}

function discardBufferedStreamOutput(runId: string): void {
  const buffer = bufferedStreamOutputsByRun.get(runId);
  if (!buffer) {
    return;
  }

  if (buffer.flushTimer) {
    const clearTimeoutFn = typeof window !== 'undefined' ? window.clearTimeout.bind(window) : clearTimeout;
    clearTimeoutFn(buffer.flushTimer);
  }
  bufferedStreamOutputsByRun.delete(runId);
}

function appendBufferedStreamOutput(runId: string, sessionId: string | null, delta: string): void {
  if (!delta) {
    return;
  }

  const current = bufferedStreamOutputsByRun.get(runId) ?? {
    output: '',
    sessionId,
    flushTimer: null,
  };
  const next = {
    ...current,
    sessionId: current.sessionId ?? sessionId,
    output: current.output + delta,
  };
  bufferedStreamOutputsByRun.set(runId, next);

  if (next.flushTimer) {
    return;
  }

  const scheduleTimeout = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
  const flushTimer = scheduleTimeout(() => {
    const buffer = bufferedStreamOutputsByRun.get(runId);
    if (buffer) {
      bufferedStreamOutputsByRun.set(runId, { ...buffer, flushTimer: null });
    }
    flushBufferedStreamOutput(runId);
  }, STREAM_OUTPUT_FLUSH_DELAY_MS);
  bufferedStreamOutputsByRun.set(runId, {
    ...next,
    flushTimer,
  });
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

export function dispatchRuntimeEvent(event: RuntimeEvent, options?: DispatchRuntimeEventOptions): void {
  const targetSessionId = resolveEventSessionId(event, options);

  if (event.eventType === 'assistant.output.delta' || event.eventType === 'model.output.delta') {
    if (!event.runId || hasTextDeltaAlreadyBeenDispatched(event)) {
      return;
    }
    const delta = event.eventType === 'assistant.output.delta'
      ? (event.payload as AssistantOutputDeltaPayload).delta
      : (event.payload as ModelOutputDeltaPayload).delta;
    appendBufferedStreamOutput(event.runId, targetSessionId, delta);
    setAgentStatusForSession(targetSessionId, 'running');
    return;
  }

  const alreadyDispatched = hasRuntimeEventAlreadyBeenDispatched(event);
  useRunStore.getState().applyRuntimeEvent(event);

  if (!event.runId || alreadyDispatched) {
    return;
  }

  applyToolEvent(event);
  applyApprovalEvent(event);

  if (event.eventType === 'run.started') {
    clearTextDeltaDispatchKeysForRun(event.runId);
    setAgentStatusForSession(targetSessionId, 'running');
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

  if (event.eventType === 'assistant.output.completed') {
    completedContentsByRun.set(event.runId, (event.payload as AssistantOutputCompletedPayload).content);
    return;
  }

  if (event.eventType === 'run.completed') {
    flushBufferedStreamOutput(event.runId);
    const completedContent = completedContentsByRun.get(event.runId)?.trim();
    const assistantContent = completedContent || streamingTextForSession(targetSessionId).trim();
    completedContentsByRun.delete(event.runId);
    if (assistantContent) {
      commitStreamForSession(targetSessionId, createMessage('assistant', assistantContent));
    } else {
      clearStreamForSession(targetSessionId);
    }
    bufferedStreamOutputsByRun.delete(event.runId);
    clearTextDeltaDispatchKeysForRun(event.runId);
    return;
  }

  if (event.eventType === 'run.failed') {
    discardBufferedStreamOutput(event.runId);
    const payload = event.payload as RunFailedPayload;
    const message = payload.error.message;
    addMessageForSession(targetSessionId, createMessage('assistant', message));
    clearStreamForSession(targetSessionId);
    setAgentStatusForSession(targetSessionId, 'error');
    setLastErrorForSession(targetSessionId, message);
    completedContentsByRun.delete(event.runId);
    clearTextDeltaDispatchKeysForRun(event.runId);
    return;
  }

  if (event.eventType === 'run.cancelled') {
    discardBufferedStreamOutput(event.runId);
    const payload = event.payload as RunCancelledPayload;
    const reason = payload.reason ?? payload.error?.message ?? 'Session message was cancelled.';
    addMessageForSession(targetSessionId, createMessage('assistant', reason));
    clearStreamForSession(targetSessionId);
    setLastErrorForSession(targetSessionId, reason);
    completedContentsByRun.delete(event.runId);
    clearTextDeltaDispatchKeysForRun(event.runId);
  }
}
