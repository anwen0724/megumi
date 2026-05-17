import type {
  AssistantOutputCompletedPayload,
  AssistantOutputDeltaPayload,
  RunCancelledPayload,
  RunFailedPayload,
  RuntimeEvent,
} from '@megumi/shared/runtime-events';
import { useChatStore } from '../../entities/chat/store';
import type { TimelineMessageData } from '../../entities/chat/types';
import { useRunStore } from '../../entities/run/store';

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

export function dispatchRuntimeEvent(event: RuntimeEvent): void {
  const alreadyDispatched = hasRuntimeEventAlreadyBeenDispatched(event);
  useRunStore.getState().applyRuntimeEvent(event);

  if (!event.runId || alreadyDispatched) {
    return;
  }

  const chatState = useChatStore.getState();

  if (event.eventType === 'run.started') {
    chatState.setAgentStatus('running');
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
