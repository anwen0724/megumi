import { create } from 'zustand';
import type { AgentRun, AgentSession } from '@megumi/shared/agent-lifecycle-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

interface AgentLifecycleState {
  sessions: AgentSession[];
  runs: Record<string, AgentRun>;
  eventsByRun: Record<string, RuntimeEvent[]>;
  activeRunId: string | null;
  lastError: string | null;
  setSessions: (sessions: AgentSession[]) => void;
  upsertRun: (run: AgentRun) => void;
  setActiveRun: (runId: string | null) => void;
  applyRuntimeEvent: (event: RuntimeEvent) => void;
  clearLifecycle: () => void;
}

function statusFromRunEvent(event: RuntimeEvent): AgentRun['status'] | undefined {
  if (event.eventType === 'run.started') {
    return 'running';
  }

  if (event.eventType === 'run.completed') {
    return 'completed';
  }

  if (event.eventType === 'run.failed') {
    return 'failed';
  }

  if (event.eventType === 'run.cancelled') {
    return 'cancelled';
  }

  if (event.eventType === 'run.status.changed') {
    const payload = event.payload as { to?: AgentRun['status'] };
    return payload.to;
  }

  return undefined;
}

function upsertEvent(events: RuntimeEvent[], event: RuntimeEvent): RuntimeEvent[] {
  if (events.some((item) => item.sequence === event.sequence)) {
    return events;
  }

  return [...events, event].sort((left, right) => left.sequence - right.sequence);
}

export const useAgentLifecycleStore = create<AgentLifecycleState>((set) => ({
  sessions: [],
  runs: {},
  eventsByRun: {},
  activeRunId: null,
  lastError: null,
  setSessions: (sessions) => set({ sessions }),
  upsertRun: (run) => set((state) => ({
    runs: {
      ...state.runs,
      [run.runId]: run,
    },
  })),
  setActiveRun: (activeRunId) => set({ activeRunId }),
  applyRuntimeEvent: (event) => set((state) => {
    if (!event.runId) {
      return state;
    }

    const runEvents = upsertEvent(state.eventsByRun[event.runId] ?? [], event);
    const nextStatus = statusFromRunEvent(event);
    const existingRun = state.runs[event.runId];
    const nextRun = nextStatus
      ? {
          ...(existingRun ?? {
            runId: event.runId,
            sessionId: event.sessionId ?? 'unknown-session',
            mode: 'unknown',
            goal: 'Runtime event stream',
            status: nextStatus,
            createdAt: event.createdAt,
          }),
          status: nextStatus,
        }
      : existingRun;

    return {
      activeRunId: event.runId,
      lastError: event.eventType === 'run.failed'
        ? ((event.payload as { error?: { message?: string } }).error?.message ?? 'Run failed.')
        : state.lastError,
      eventsByRun: {
        ...state.eventsByRun,
        [event.runId]: runEvents,
      },
      runs: nextRun
        ? {
            ...state.runs,
            [event.runId]: nextRun,
          }
        : state.runs,
    };
  }),
  clearLifecycle: () => set({
    sessions: [],
    runs: {},
    eventsByRun: {},
    activeRunId: null,
    lastError: null,
  }),
}));
