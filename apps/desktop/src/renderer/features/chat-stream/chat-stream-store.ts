import { create } from 'zustand';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream-events';
import type { TimelineMessage } from '@megumi/shared/timeline-message-blocks';
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
  reset(): void;
}

export function chatStreamSessionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
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
