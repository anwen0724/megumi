import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { ChatStreamEventSchema } from '@megumi/shared/chat-stream-event-schemas';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream-events';
import { redactRuntimeValue } from '@megumi/security/redaction';
import {
  noopRuntimeLogger,
  type RuntimeLogger,
} from '../services/runtime-logger.service';

export interface ChatStreamEventSender {
  send(channel: string, event: ChatStreamEvent): void;
}

export interface ForwardChatStreamEventOptions {
  logger?: RuntimeLogger;
}

export function forwardChatStreamEvent(
  sender: ChatStreamEventSender,
  event: ChatStreamEvent,
  options: ForwardChatStreamEventOptions = {},
): void {
  const logger = options.logger ?? noopRuntimeLogger;
  const parsed = ChatStreamEventSchema.safeParse(event);

  if (!parsed.success) {
    logger.warn('chat_stream_event_invalid', {
      ...eventDiagnostics(event),
      issueCount: parsed.error.issues.length,
    });
    return;
  }

  try {
    sender.send(
      IPC_CHANNELS.chatStream.event,
      redactRuntimeValue(parsed.data) as ChatStreamEvent,
    );
  } catch {
    logger.error('chat_stream_event_send_failed', {
      ...eventDiagnostics(parsed.data),
      message: 'Chat stream event delivery failed.',
    });
  }
}

function eventDiagnostics(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== 'object') {
    return { eventType: 'unknown' };
  }

  const value = event as Partial<ChatStreamEvent>;
  return redactRuntimeValue({
    eventId: value.eventId,
    eventType: value.eventType,
    projectId: value.projectId,
    sessionId: value.sessionId,
    runId: value.runId,
    streamId: value.streamId,
    seq: value.seq,
  }) as Record<string, unknown>;
}
