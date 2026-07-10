import { create } from 'zustand';
import type { RuntimeEvent } from '@megumi/product/runtime-events';
import {
  reduceRuntimeTimelineEvent,
  type AnswerTextBlock,
  type ProcessDisclosureBlock,
  type TimelineAssistantMessage,
  type TimelineMessage,
  type TimelineUserMessage,
} from '@megumi/product/runtime-timeline';

export type RuntimeTimelineStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'needs_replay';
export type TimelineHydrationStatus = 'idle' | 'hydrating' | 'ready' | 'failed';

export interface RuntimeTimelineState {
  streamId: string;
  runId: string;
  streamKind: string;
  lastSeq: number;
  status: RuntimeTimelineStatus;
  needsReplay: boolean;
  gap?: {
    expectedSeq: number;
    receivedSeq: number;
  };
}

export interface RuntimeTimelineSessionState {
  projectId: string;
  sessionId: string;
  messages: TimelineMessage[];
  streamsById: Record<string, RuntimeTimelineState>;
  appliedEventIds: Record<string, true>;
}

export interface SessionTimelineHydrationState {
  projectId: string;
  sessionId: string;
  sessionUpdatedAt: string;
  status: TimelineHydrationStatus;
  hydratedAt?: string;
  error?: string;
}

export interface RuntimeTimelineStoreState {
  activeProjectId: string | null;
  activeSessionId: string | null;
  activeSessionKey: string | null;
  sessions: Record<string, RuntimeTimelineSessionState>;
  hydrationBySessionKey: Record<string, SessionTimelineHydrationState>;
  setActiveSession(projectId: string | null, sessionId: string | null): void;
  dispatch(event: RuntimeEvent): void;
  flushStream(projectId: string, sessionId: string, streamId: string): void;
  addPendingUserMessage(
    projectId: string,
    sessionId: string,
    input: { clientMessageId: string; text: string; createdAt: string; runId?: string },
  ): void;
  hydrateCommittedMessages(projectId: string, sessionId: string, messages: TimelineMessage[]): void;
  hydrateSessionTimeline(projectId: string, sessionId: string, messages: TimelineMessage[], events: RuntimeEvent[]): void;
  getHydrationState(projectId: string, sessionId: string): SessionTimelineHydrationState | undefined;
  isSessionTimelineFresh(projectId: string, sessionId: string, sessionUpdatedAt: string): boolean;
  markSessionTimelineHydrating(projectId: string, sessionId: string, sessionUpdatedAt: string): void;
  markSessionTimelineHydrated(projectId: string, sessionId: string, sessionUpdatedAt: string): void;
  markSessionTimelineHydrationFailed(
    projectId: string,
    sessionId: string,
    sessionUpdatedAt: string,
    message: string,
  ): void;
  reset(): void;
}

export function runtimeTimelineSessionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

function isActiveProcessItemStatus(status: string | undefined): boolean {
  return status === 'running' || status === 'streaming' || status === 'pending';
}

function isLiveStreamingMessage(
  message: TimelineMessage,
  streamsById: Record<string, RuntimeTimelineState>,
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

  if (message.runId) {
    return `user-run:${message.sessionId}:${message.runId}`;
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
    runId?: string;
  },
): TimelineMessage[] {
  const existing = current.find(
    (message): message is TimelineUserMessage =>
      message.role === 'user' &&
      (
        message.messageId === input.clientMessageId ||
        message.clientMessageId === input.clientMessageId ||
        (Boolean(input.runId) && message.runId === input.runId)
      ),
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
        ...(input.runId ? { runId: input.runId } : {}),
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
    ...(input.runId ? { runId: input.runId } : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    blocks: [block],
  };

  return [...current, message].sort(compareTimelineMessages);
}

function isActiveRunMessage(
  message: TimelineMessage,
  streamsById: Record<string, RuntimeTimelineState>,
): boolean {
  if (message.role !== 'assistant' && message.role !== 'user') {
    return false;
  }

  return Object.values(streamsById).some((stream) =>
    stream.runId === message.runId && (stream.status === 'running' || stream.status === 'needs_replay')
  );
}

function assistantProcessBlocks(message: TimelineAssistantMessage): ProcessDisclosureBlock[] {
  return message.blocks.filter((block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure');
}

function assistantAnswerBlocks(message: TimelineAssistantMessage): AnswerTextBlock[] {
  return message.blocks.filter((block): block is AnswerTextBlock => block.kind === 'answer_text');
}

function mergeAssistantMessage(
  committed: TimelineAssistantMessage,
  runtime: TimelineAssistantMessage,
): TimelineAssistantMessage {
  const processBlocks = new Map<string, ProcessDisclosureBlock>();
  for (const block of assistantProcessBlocks(committed)) {
    processBlocks.set(block.blockId, block);
  }
  for (const block of assistantProcessBlocks(runtime)) {
    processBlocks.set(block.blockId, block);
  }

  const committedAnswerBlocks = assistantAnswerBlocks(committed);
  const runtimeAnswerBlocks = assistantAnswerBlocks(runtime);
  const answerBlocks = committedAnswerBlocks.length > 0 ? committedAnswerBlocks : runtimeAnswerBlocks;
  const updatedAt = [committed.updatedAt, runtime.updatedAt].filter(Boolean).sort().at(-1);

  return {
    ...committed,
    ...(updatedAt ? { updatedAt } : {}),
    workspaceChangeFooter: committed.workspaceChangeFooter ?? runtime.workspaceChangeFooter,
    blocks: [
      ...processBlocks.values(),
      ...answerBlocks,
    ],
  };
}

function mergeCommittedMessages(
  current: TimelineMessage[],
  committed: TimelineMessage[],
  streamsById: Record<string, RuntimeTimelineState>,
): TimelineMessage[] {
  const byIdentity = new Map<string, TimelineMessage>();

  for (const message of committed) {
    byIdentity.set(messageIdentity(message), message);
  }

  for (const message of current) {
    const identity = messageIdentity(message);
    const committedMessage = byIdentity.get(identity);
    if (committedMessage?.role === 'assistant' && message.role === 'assistant') {
      byIdentity.set(identity, mergeAssistantMessage(committedMessage, message));
      continue;
    }

    if (isLiveStreamingMessage(message, streamsById) || isActiveRunMessage(message, streamsById)) {
      byIdentity.set(identity, message);
    }
  }

  return [...byIdentity.values()].sort(compareTimelineMessages);
}

function emptySession(projectId: string, sessionId: string): RuntimeTimelineSessionState {
  return {
    projectId,
    sessionId,
    messages: [],
    streamsById: {},
    appliedEventIds: {},
  };
}

function projectRuntimeEvent(
  session: RuntimeTimelineSessionState,
  event: RuntimeEvent,
): RuntimeTimelineSessionState {
  if (session.appliedEventIds[event.eventId]) {
    return session;
  }

  const streamId = event.runId ?? event.eventId;
  const currentStream = session.streamsById[streamId] ?? {
    streamId,
    runId: event.runId ?? streamId,
    streamKind: 'main',
    lastSeq: 0,
    status: 'running' as const,
    needsReplay: false,
  };
  const nextStream: RuntimeTimelineState = {
    ...currentStream,
    lastSeq: Math.max(currentStream.lastSeq, event.sequence),
    status: statusFromEvent(event, currentStream.status),
  };

  return {
    ...session,
    messages: reduceRuntimeTimelineEvent(session.messages, event),
    streamsById: {
      ...session.streamsById,
      [streamId]: nextStream,
    },
    appliedEventIds: {
      ...session.appliedEventIds,
      [event.eventId]: true,
    },
  };
}

export const useRuntimeTimelineStore = create<RuntimeTimelineStoreState>((set, get) => {
  function eventProjectId(): string {
    return get().activeProjectId ?? 'runtime';
  }

  function eventSessionId(event: RuntimeEvent): string {
    return event.sessionId ?? get().activeSessionId ?? 'session:unknown';
  }

  function applyProjectedEvent(event: RuntimeEvent): void {
    set((state) => {
      const projectId = eventProjectId();
      const sessionId = eventSessionId(event);
      const key = runtimeTimelineSessionKey(projectId, sessionId);
      const session = state.sessions[key] ?? emptySession(projectId, sessionId);
      const nextSession = projectRuntimeEvent(session, event);
      if (nextSession === session) return state;

      return {
        sessions: {
          ...state.sessions,
          [key]: nextSession,
        },
      };
    });
  }

  return {
    activeProjectId: null,
    activeSessionId: null,
    activeSessionKey: null,
    sessions: {},
    hydrationBySessionKey: {},
    setActiveSession: (activeProjectId, activeSessionId) => set(activeProjectId && activeSessionId
      ? {
          activeProjectId,
          activeSessionId,
          activeSessionKey: runtimeTimelineSessionKey(activeProjectId, activeSessionId),
        }
      : {
          activeProjectId: null,
          activeSessionId: null,
          activeSessionKey: null,
        }),
    dispatch: applyProjectedEvent,
    flushStream: (projectId, sessionId, streamId) => {
      void projectId;
      void sessionId;
      void streamId;
    },
    addPendingUserMessage: (projectId, sessionId, input) => {
      set((state) => {
        const key = runtimeTimelineSessionKey(projectId, sessionId);
        const session = state.sessions[key] ?? emptySession(projectId, sessionId);

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
        const key = runtimeTimelineSessionKey(projectId, sessionId);
        const session = state.sessions[key] ?? emptySession(projectId, sessionId);

        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...session,
              messages: mergeCommittedMessages([], messages, {}),
              streamsById: {},
              appliedEventIds: {},
            },
          },
        };
      });
    },
    hydrateSessionTimeline: (projectId, sessionId, messages, events) => {
      set((state) => {
        const key = runtimeTimelineSessionKey(projectId, sessionId);
        const baseSession: RuntimeTimelineSessionState = {
          ...emptySession(projectId, sessionId),
          messages: mergeCommittedMessages([], messages, {}),
        };
        const hydratedSession = events.reduce(
          (session, event) => projectRuntimeEvent(session, {
            ...event,
            sessionId: event.sessionId ?? sessionId,
          }),
          baseSession,
        );

        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...hydratedSession,
              messages: [...hydratedSession.messages].sort(compareTimelineMessages),
            },
          },
        };
      });
    },
    getHydrationState: (projectId, sessionId) =>
      get().hydrationBySessionKey[runtimeTimelineSessionKey(projectId, sessionId)],
    isSessionTimelineFresh: (projectId, sessionId, sessionUpdatedAt) => {
      const hydration = get().hydrationBySessionKey[runtimeTimelineSessionKey(projectId, sessionId)];
      return hydration?.status === 'ready' && hydration.sessionUpdatedAt === sessionUpdatedAt;
    },
    markSessionTimelineHydrating: (projectId, sessionId, sessionUpdatedAt) => {
      set((state) => {
        const key = runtimeTimelineSessionKey(projectId, sessionId);
        return {
          hydrationBySessionKey: {
            ...state.hydrationBySessionKey,
            [key]: {
              projectId,
              sessionId,
              sessionUpdatedAt,
              status: 'hydrating',
            },
          },
        };
      });
    },
    markSessionTimelineHydrated: (projectId, sessionId, sessionUpdatedAt) => {
      set((state) => {
        const key = runtimeTimelineSessionKey(projectId, sessionId);
        return {
          hydrationBySessionKey: {
            ...state.hydrationBySessionKey,
            [key]: {
              projectId,
              sessionId,
              sessionUpdatedAt,
              status: 'ready',
              hydratedAt: new Date().toISOString(),
            },
          },
        };
      });
    },
    markSessionTimelineHydrationFailed: (projectId, sessionId, sessionUpdatedAt, message) => {
      set((state) => {
        const key = runtimeTimelineSessionKey(projectId, sessionId);
        return {
          hydrationBySessionKey: {
            ...state.hydrationBySessionKey,
            [key]: {
              projectId,
              sessionId,
              sessionUpdatedAt,
              status: 'failed',
              error: message,
            },
          },
        };
      });
    },
    reset: () => {
      set({
        activeProjectId: null,
        activeSessionId: null,
        activeSessionKey: null,
        sessions: {},
        hydrationBySessionKey: {},
      });
    },
  };
});

function statusFromEvent(event: RuntimeEvent, current: RuntimeTimelineStatus): RuntimeTimelineStatus {
  if (current === 'needs_replay') return current;
  if (event.eventType === 'run.completed') return 'completed';
  if (event.eventType === 'run.failed') return 'failed';
  if (event.eventType === 'run.cancelled') return 'cancelled';
  return 'running';
}
