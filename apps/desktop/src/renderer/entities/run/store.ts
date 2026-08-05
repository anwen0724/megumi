import { create } from 'zustand';
import type { AnyEvent } from '@megumi/product/host';

export type RendererRunStatus =
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RendererRunSummary {
  runId: string;
  sessionId?: string;
  status: RendererRunStatus;
  updatedAt: string;
}

interface RunState {
  activeRunId: string | null;
  runs: Record<string, RendererRunSummary>;
  eventsByRun: Record<string, AnyEvent[]>;
  lastError: string | null;
  setActiveRun: (runId: string | null) => void;
  applyRuntimeEvent: (event: AnyEvent) => void;
  resetRuns: () => void;
}

function statusFromEvent(event: AnyEvent): RendererRunStatus | null {
  if (event.type === 'run.started') return 'running';
  if (event.type === 'approval.requested') return 'waiting';
  if (event.type === 'run.ended') {
    const status = event.payload.status;
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'cancelled') return 'cancelled';
  }
  return null;
}

function upsertEvent(events: AnyEvent[], event: AnyEvent): AnyEvent[] {
  if (events.some((item) => item.id === event.id)) {
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
      lastError: event.type === 'run.ended' && event.payload.status === 'failed'
        ? event.payload.error?.message ?? 'Run failed.'
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
