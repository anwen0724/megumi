import { create } from 'zustand';
import type { RunStatus } from '@megumi/shared/session-run-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

export type RendererRunStatus = RunStatus;

export interface RendererRunSummary {
  runId: string;
  sessionId?: string;
  status: RendererRunStatus;
  updatedAt: string;
}

interface RunState {
  activeRunId: string | null;
  runs: Record<string, RendererRunSummary>;
  eventsByRun: Record<string, RuntimeEvent[]>;
  lastError: string | null;
  setActiveRun: (runId: string | null) => void;
  applyRuntimeEvent: (event: RuntimeEvent) => void;
  resetRuns: () => void;
}

function statusFromEvent(event: RuntimeEvent): RendererRunStatus | null {
  if (event.eventType === 'run.started') return 'running';
  if (event.eventType === 'run.completed') return 'completed';
  if (event.eventType === 'run.failed') return 'failed';
  if (event.eventType === 'run.cancelled') return 'cancelled';
  if (event.eventType === 'run.status.changed') {
    const to = (event.payload as { to?: RendererRunStatus }).to;
    return to ?? null;
  }
  return null;
}

function upsertEvent(events: RuntimeEvent[], event: RuntimeEvent): RuntimeEvent[] {
  if (events.some((item) => item.eventId === event.eventId || item.sequence === event.sequence)) {
    return events;
  }
  return [...events, event].sort((left, right) => left.sequence - right.sequence);
}

export const useRunStore = create<RunState>((set) => ({
  activeRunId: null,
  runs: {},
  eventsByRun: {},
  lastError: null,
  setActiveRun: (activeRunId) => set({ activeRunId }),
  applyRuntimeEvent: (event) => set((state) => {
    if (!event.runId) {
      return state;
    }

    const nextStatus = statusFromEvent(event);
    const existing = state.runs[event.runId];
    const nextRun = {
      ...(existing ?? {
        runId: event.runId,
        sessionId: event.sessionId,
        status: nextStatus ?? 'running',
        updatedAt: event.createdAt,
      }),
      ...(nextStatus ? { status: nextStatus } : {}),
      updatedAt: event.createdAt,
    };

    return {
      activeRunId: event.runId,
      runs: {
        ...state.runs,
        [event.runId]: nextRun,
      },
      eventsByRun: {
        ...state.eventsByRun,
        [event.runId]: upsertEvent(state.eventsByRun[event.runId] ?? [], event),
      },
      lastError: event.eventType === 'run.failed'
        ? ((event.payload as { error?: { message?: string } }).error?.message ?? 'Run failed.')
        : state.lastError,
    };
  }),
  resetRuns: () => set({
    activeRunId: null,
    runs: {},
    eventsByRun: {},
    lastError: null,
  }),
}));
