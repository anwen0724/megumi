import { create } from 'zustand';
import type { ChatStreamEvent } from '@megumi/renderer-contracts/chat-stream';
import type { TimelineMessage, TimelineUserMessage } from '@megumi/renderer-contracts/timeline';
import { createChatStreamBuffer, type ChatStreamBuffer } from './chat-stream-buffer';
import { reduceChatStreamEvent } from './chat-stream-projection';

export type ChatStreamStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'needs_replay';

export interface ChatStreamState {
  streamId: string;
  runId: string;
  streamKind: string;
  lastSeq: number;
  status: ChatStreamStatus;
  needsReplay: boolean;
  gap?: {
    expectedSeq: number;
    receivedSeq: number;
  };
}

export interface ChatStreamSessionState {
  projectId: string;
  sessionId: string;
  messages: TimelineMessage[];
  streamsById: Record<string, ChatStreamState>;
}

export interface ChatStreamStoreState {
  activeProjectId: string | null;
  activeSessionId: string | null;
  activeSessionKey: string | null;
  sessions: Record<string, ChatStreamSessionState>;
  setActiveSession(projectId: string | null, sessionId: string | null): void;
  dispatch(event: ChatStreamEvent): void;
  flushStream(projectId: string, sessionId: string, streamId: string): void;
  addPendingUserMessage(
    projectId: string,
    sessionId: string,
    input: { clientMessageId: string; text: string; createdAt: string },
  ): void;
  hydrateCommittedMessages(projectId: string, sessionId: string, messages: TimelineMessage[]): void;
  reset(): void;
}

export function chatStreamSessionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

function isActiveProcessItemStatus(status: string | undefined): boolean {
  return status === 'running' || status === 'streaming' || status === 'pending';
}

function isLiveStreamingMessage(
  message: TimelineMessage,
  streamsById: Record<string, ChatStreamState>,
): boolean {
  if (message.role !== 'assistant') {
    return false;
  }

  if (Object.values(streamsById).some((stream) =>
    stream.runId === message.runId && (stream.status === 'running' || stream.status === 'needs_replay')
  )) {
    return true;
  }

  return message.blocks.some((block) => {
    if (block.kind === 'answer_text') {
      return block.status === 'streaming';
    }

    if (block.status === 'running') {
      return true;
    }

    return block.items.some((item) =>
      'status' in item && isActiveProcessItemStatus(item.status)
    );
  });
}

function messageIdentity(message: TimelineMessage): string {
  if (message.role === 'assistant') {
    return `assistant:${message.runId}`;
  }

  if (message.role === 'separator') {
    return `separator:${message.messageId}`;
  }

  return `user:${message.clientMessageId ?? message.messageId}`;
}

function messageRunId(message: TimelineMessage): string {
  if (message.role === 'assistant' || message.role === 'user') {
    return String(message.runId ?? '');
  }

  return '';
}

function messageTurnOrder(message: TimelineMessage): number {
  if (message.turnOrder !== undefined) return message.turnOrder;
  if (message.role === 'user') return 0;
  if (message.role === 'assistant') return 1;
  return 2;
}

function compareTimelineMessages(left: TimelineMessage, right: TimelineMessage): number {
  const createdOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdOrder !== 0) return createdOrder;

  const runOrder = messageRunId(left).localeCompare(messageRunId(right));
  if (runOrder !== 0) return runOrder;

  const turnOrder = messageTurnOrder(left) - messageTurnOrder(right);
  if (turnOrder !== 0) return turnOrder;

  return String(left.messageId).localeCompare(String(right.messageId));
}

function upsertPendingUserMessage(
  current: TimelineMessage[],
  input: {
    projectId: string;
    sessionId: string;
    clientMessageId: string;
    text: string;
    createdAt: string;
  },
): TimelineMessage[] {
  const existing = current.find(
    (message): message is TimelineUserMessage =>
      message.role === 'user' && message.messageId === input.clientMessageId,
  );
  const block = {
    blockId: `user-text:${input.clientMessageId}`,
    kind: 'user_text' as const,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    text: input.text,
    format: 'plain' as const,
  };

  if (existing) {
    return current.map((message) => {
      if (message !== existing) {
        return message;
      }

      const blockIndex = existing.blocks.findIndex((candidate) => candidate.kind === 'user_text');
      const blocks = blockIndex === -1
        ? [...existing.blocks, block]
        : existing.blocks.map((candidate, index) => index === blockIndex ? block : candidate);

      return {
        ...existing,
        projectId: input.projectId,
        sessionId: input.sessionId,
        clientMessageId: input.clientMessageId,
        updatedAt: input.createdAt,
        blocks,
      };
    });
  }

  const message: TimelineUserMessage = {
    messageId: input.clientMessageId,
    role: 'user',
    projectId: input.projectId,
    sessionId: input.sessionId,
    turnOrder: 0,
    clientMessageId: input.clientMessageId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    blocks: [block],
  };

  return [...current, message].sort(compareTimelineMessages);
}

function mergeCommittedMessages(
  current: TimelineMessage[],
  committed: TimelineMessage[],
  streamsById: Record<string, ChatStreamState>,
): TimelineMessage[] {
  const byIdentity = new Map<string, TimelineMessage>();

  for (const message of committed) {
    byIdentity.set(messageIdentity(message), message);
  }

  for (const message of current) {
    const identity = messageIdentity(message);
    if (isLiveStreamingMessage(message, streamsById)) {
      byIdentity.set(identity, message);
      continue;
    }

    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, message);
    }
  }

  return [...byIdentity.values()].sort(compareTimelineMessages);
}

export const useChatStreamStore = create<ChatStreamStoreState>((set, get) => {
  const buffers = new Map<string, ChatStreamBuffer>();

  function sessionKey(event: Pick<ChatStreamEvent, 'projectId' | 'sessionId'>): string {
    return chatStreamSessionKey(event.projectId, event.sessionId);
  }

  function streamKey(event: Pick<ChatStreamEvent, 'projectId' | 'sessionId' | 'streamId'>): string {
    return `${sessionKey(event)}:${event.streamId}`;
  }

  function ensureSession(event: ChatStreamEvent): ChatStreamSessionState {
    const state = get();
    const existing = state.sessions[sessionKey(event)];
    if (existing) return existing;
    return {
      projectId: event.projectId,
      sessionId: event.sessionId,
      messages: [],
      streamsById: {},
    };
  }

  function applyProjectedEvent(event: ChatStreamEvent): void {
    set((state) => {
      const key = sessionKey(event);
      const session = state.sessions[key] ?? {
        projectId: event.projectId,
        sessionId: event.sessionId,
        messages: [],
        streamsById: {},
      };
      const currentStream = session.streamsById[event.streamId] ?? {
        streamId: event.streamId,
        runId: event.runId,
        streamKind: event.streamKind,
        lastSeq: 0,
        status: 'running' as const,
        needsReplay: false,
      };
      const nextStream: ChatStreamState = {
        ...currentStream,
        lastSeq: Math.max(currentStream.lastSeq, event.seq),
        status: statusFromEvent(event, currentStream.status),
      };

      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            messages: reduceChatStreamEvent(session.messages, event),
            streamsById: {
              ...session.streamsById,
              [event.streamId]: nextStream,
            },
          },
        },
      };
    });
  }

  function markGap(event: ChatStreamEvent, expectedSeq: number, receivedSeq: number): void {
    set((state) => {
      const key = sessionKey(event);
      const session = state.sessions[key] ?? ensureSession(event);
      const currentStream = session.streamsById[event.streamId] ?? {
        streamId: event.streamId,
        runId: event.runId,
        streamKind: event.streamKind,
        lastSeq: expectedSeq - 1,
        status: 'running' as const,
        needsReplay: false,
      };
      const nextStream: ChatStreamState = currentStream.needsReplay && currentStream.gap
        ? currentStream
        : {
            ...currentStream,
            status: 'needs_replay' as const,
            needsReplay: true,
            gap: { expectedSeq, receivedSeq },
          };

      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            streamsById: {
              ...session.streamsById,
              [event.streamId]: nextStream,
            },
          },
        },
      };
    });
  }

  function bufferFor(event: ChatStreamEvent): ChatStreamBuffer {
    const key = streamKey(event);
    const existing = buffers.get(key);
    if (existing) return existing;

    const buffer = createChatStreamBuffer({
      applyEvent: applyProjectedEvent,
      flushIntervalMs: 100,
      onGap: ({ expectedSeq, receivedSeq, event: gapEvent }) => {
        markGap(gapEvent, expectedSeq, receivedSeq);
      },
    });
    buffers.set(key, buffer);
    return buffer;
  }

  return {
    activeProjectId: null,
    activeSessionId: null,
    activeSessionKey: null,
    sessions: {},
    setActiveSession: (activeProjectId, activeSessionId) => set(activeProjectId && activeSessionId
      ? {
          activeProjectId,
          activeSessionId,
          activeSessionKey: chatStreamSessionKey(activeProjectId, activeSessionId),
        }
      : {
          activeProjectId: null,
          activeSessionId: null,
          activeSessionKey: null,
        }),
    dispatch: (event) => {
      bufferFor(event).handle(event);
    },
    flushStream: (projectId, sessionId, streamId) => {
      buffers.get(`${projectId}:${sessionId}:${streamId}`)?.flush();
    },
    addPendingUserMessage: (projectId, sessionId, input) => {
      set((state) => {
        const key = chatStreamSessionKey(projectId, sessionId);
        const session = state.sessions[key] ?? {
          projectId,
          sessionId,
          messages: [],
          streamsById: {},
        };

        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...session,
              messages: upsertPendingUserMessage(session.messages, {
                projectId,
                sessionId,
                ...input,
              }),
            },
          },
        };
      });
    },
    hydrateCommittedMessages: (projectId, sessionId, messages) => {
      set((state) => {
        const key = chatStreamSessionKey(projectId, sessionId);
        const session = state.sessions[key] ?? {
          projectId,
          sessionId,
          messages: [],
          streamsById: {},
        };

        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...session,
              messages: mergeCommittedMessages(session.messages, messages, session.streamsById),
            },
          },
        };
      });
    },
    reset: () => {
      for (const buffer of buffers.values()) {
        buffer.dispose();
      }
      buffers.clear();
      set({
        activeProjectId: null,
        activeSessionId: null,
        activeSessionKey: null,
        sessions: {},
      });
    },
  };
});

function statusFromEvent(event: ChatStreamEvent, current: ChatStreamStatus): ChatStreamStatus {
  if (current === 'needs_replay') return current;
  if (event.eventType === 'turn.completed') return 'completed';
  if (event.eventType === 'turn.failed') return 'failed';
  if (event.eventType === 'turn.cancelled') return 'cancelled';
  return 'running';
}

