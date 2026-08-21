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
  executionId: string;
  sessionId?: string;
  status: RendererRunStatus;
  updatedAt: string;
}

interface RunState {
  activeExecutionId: string | null;
  runs: Record<string, RendererRunSummary>;
  eventsByRun: Record<string, AnyEvent[]>;
  lastError: string | null;
  setActiveRun: (executionId: string | null) => void;
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
  activeExecutionId: null,
  runs: {},
  eventsByRun: {},
  lastError: null,
  setActiveRun: (activeExecutionId) => set({ activeExecutionId }),
  applyRuntimeEvent: (event) => set((state) => {
    if (!event.executionId) {
      return state;
    }

    const nextStatus = statusFromEvent(event);
    const existing = state.runs[event.executionId];
    const nextRun = {
      ...(existing ?? {
        executionId: event.executionId,
        sessionId: event.sessionId,
        status: nextStatus ?? 'running',
        updatedAt: event.createdAt,
      }),
      ...(nextStatus ? { status: nextStatus } : {}),
      updatedAt: event.createdAt,
    };

    return {
      activeExecutionId: event.executionId,
      runs: {
        ...state.runs,
        [event.executionId]: nextRun,
      },
      eventsByRun: {
        ...state.eventsByRun,
        [event.executionId]: upsertEvent(state.eventsByRun[event.executionId] ?? [], event),
      },
      lastError: event.type === 'run.ended' && event.payload.status === 'failed'
        ? event.payload.error?.message ?? 'Run failed.'
        : state.lastError,
    };
  }),
  resetRuns: () => set({
    activeExecutionId: null,
    runs: {},
    eventsByRun: {},
    lastError: null,
  }),
}));
