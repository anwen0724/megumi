/*
 * Owns the single Desktop Session Timeline presentation state.
 * Async reads and event subscriptions are coordinated by the synchronizer.
 */
import { create } from 'zustand';
import type { AnyEvent } from '@megumi/product/host';
import type { SessionBranchConversationItemDto } from '@megumi/product/host';
import { toTimelineBranchSeparator } from './session-timeline-builder';
import { reduceRuntimeTimelineEvent } from './runtime-timeline-reducer';
import {
  reconcileCommittedRunMessages,
  reconcileTimelineMessages,
  upsertPendingUserMessage,
  type PendingUserMessageInput,
} from './timeline-reconciler';
import type { TimelineMessage } from './timeline-model';

export type SessionTimelineRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface SessionTimelineState {
  readonly projectId: string;
  readonly sessionId: string;
  readonly messages: TimelineMessage[];
  readonly runStatusById: Readonly<Record<string, SessionTimelineRunStatus>>;
  readonly appliedEventIds: Readonly<Record<string, true>>;
  readonly lastSequence: number;
}

export interface SessionTimelineStoreState {
  readonly activeProjectId: string | null;
  readonly activeSessionId: string | null;
  readonly activeSessionKey: string | null;
  readonly sessions: Readonly<Record<string, SessionTimelineState>>;

  setActiveSession(projectId: string | null, sessionId: string | null): void;
  applyRuntimeEvent(projectId: string, event: AnyEvent): void;
  addPendingUserMessage(input: PendingUserMessageInput): void;
  addCommittedBranch(
    projectId: string,
    sessionId: string,
    branch: SessionBranchConversationItemDto,
  ): void;
  noteEventSequence(projectId: string, sessionId: string, sequence: number): void;
  /** Merges a complete durable Session read while retaining only unmatched live presentation state. */
  reconcileSessionHistory(
    projectId: string,
    sessionId: string,
    messages: readonly TimelineMessage[],
  ): void;
  /** Replaces the committed facts for one terminal Run without touching sibling Timeline entries. */
  reconcileCommittedRun(
    projectId: string,
    sessionId: string,
    runId: string,
    messages: readonly TimelineMessage[],
  ): void;
  reset(): void;
}

/** Returns the stable key used to isolate Timeline state between Sessions. */
export function sessionTimelineKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

/**
 * Stores presentation state only. Callers remain responsible for listening,
 * buffering, reading Session facts, and deciding when recovery is required.
 */
export const useSessionTimelineStore = create<SessionTimelineStoreState>((set) => ({
  activeProjectId: null,
  activeSessionId: null,
  activeSessionKey: null,
  sessions: {},

  setActiveSession: (activeProjectId, activeSessionId) => set(activeProjectId && activeSessionId
    ? {
        activeProjectId,
        activeSessionId,
        activeSessionKey: sessionTimelineKey(activeProjectId, activeSessionId),
      }
    : {
        activeProjectId: null,
        activeSessionId: null,
        activeSessionKey: null,
      }),

  applyRuntimeEvent: (projectId, event) => {
    set((state) => {
      const key = sessionTimelineKey(projectId, event.sessionId);
      const session = state.sessions[key] ?? emptySessionTimeline(projectId, event.sessionId);
      if (session.appliedEventIds[event.id]) return state;

      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            messages: reduceRuntimeTimelineEvent(session.messages, event, projectId),
            runStatusById: updateRunStatus(session.runStatusById, event),
            appliedEventIds: {
              ...session.appliedEventIds,
              [event.id]: true,
            },
            lastSequence: Math.max(session.lastSequence, event.sequence),
          },
        },
      };
    });
  },

  addPendingUserMessage: (input) => {
    set((state) => {
      const key = sessionTimelineKey(input.projectId, input.sessionId);
      const session = state.sessions[key] ?? emptySessionTimeline(input.projectId, input.sessionId);
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            messages: upsertPendingUserMessage(session.messages, input),
          },
        },
      };
    });
  },

  addCommittedBranch: (projectId, sessionId, branch) => {
    set((state) => {
      const key = sessionTimelineKey(projectId, sessionId);
      const session = state.sessions[key] ?? emptySessionTimeline(projectId, sessionId);
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            messages: reconcileTimelineMessages(
              session.messages,
              [toTimelineBranchSeparator(projectId, sessionId, branch)],
              { preserveRuntimeOnly: true },
            ),
          },
        },
      };
    });
  },

  noteEventSequence: (projectId, sessionId, sequence) => {
    set((state) => {
      const key = sessionTimelineKey(projectId, sessionId);
      const session = state.sessions[key] ?? emptySessionTimeline(projectId, sessionId);
      if (sequence <= session.lastSequence) return state;
      return {
        sessions: {
          ...state.sessions,
          [key]: { ...session, lastSequence: sequence },
        },
      };
    });
  },

  reconcileSessionHistory: (projectId, sessionId, messages) => {
    set((state) => {
      const key = sessionTimelineKey(projectId, sessionId);
      const session = state.sessions[key] ?? emptySessionTimeline(projectId, sessionId);
      const activeRunIds = new Set(Object.entries(session.runStatusById)
        .flatMap(([runId, status]) => status === 'running' ? [runId] : []));
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            messages: reconcileTimelineMessages(session.messages, messages, {
              activeRunIds,
            }),
          },
        },
      };
    });
  },

  reconcileCommittedRun: (projectId, sessionId, runId, messages) => {
    set((state) => {
      const key = sessionTimelineKey(projectId, sessionId);
      const session = state.sessions[key] ?? emptySessionTimeline(projectId, sessionId);
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            messages: reconcileCommittedRunMessages(session.messages, runId, messages),
          },
        },
      };
    });
  },

  reset: () => set({
    activeProjectId: null,
    activeSessionId: null,
    activeSessionKey: null,
    sessions: {},
  }),
}));

function emptySessionTimeline(projectId: string, sessionId: string): SessionTimelineState {
  return {
    projectId,
    sessionId,
    messages: [],
    runStatusById: {},
    appliedEventIds: {},
    lastSequence: 0,
  };
}

function updateRunStatus(
  current: Readonly<Record<string, SessionTimelineRunStatus>>,
  event: AnyEvent,
): Readonly<Record<string, SessionTimelineRunStatus>> {
  if (!event.runId) return current;
  if (event.type === 'run.ended') {
    return {
      ...current,
      [event.runId]: event.payload.status,
    };
  }
  if (event.type !== 'run.started') return current;
  return {
    ...current,
    [event.runId]: 'running',
  };
}
