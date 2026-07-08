import { create } from 'zustand';
import type { RuntimeEvent } from '@megumi/coding-agent/events';

export type RendererRunStatus = 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled' | string;
export type RunStepKind = string;
export type RunStepStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | string;

export interface RendererRunSummary {
  runId: string;
  sessionId?: string;
  status: RendererRunStatus;
  updatedAt: string;
}

export interface RendererRunStepSummary {
  stepId: string;
  runId: string;
  kind?: RunStepKind;
  title?: string;
  status: RunStepStatus;
  updatedAt: string;
  errorMessage?: string;
}

interface RunState {
  activeRunId: string | null;
  runs: Record<string, RendererRunSummary>;
  eventsByRun: Record<string, RuntimeEvent[]>;
  stepsByRun: Record<string, Record<string, RendererRunStepSummary>>;
  lastError: string | null;
  setActiveRun: (runId: string | null) => void;
  applyRuntimeEvent: (event: RuntimeEvent) => void;
  resetRuns: () => void;
}

function stepSummaryFromEvent(
  event: RuntimeEvent,
  existing: RendererRunStepSummary | undefined,
): RendererRunStepSummary | null {
  if (!event.runId || !event.stepId) {
    return null;
  }

  if (event.eventType === 'step.created') {
    const payload = event.payload as {
      kind?: RunStepKind;
      status?: RunStepStatus;
      title?: string;
    };
    return {
      ...(existing ?? { stepId: event.stepId, runId: event.runId }),
      kind: payload.kind ?? existing?.kind,
      title: payload.title ?? existing?.title,
      status: payload.status ?? existing?.status ?? 'running',
      updatedAt: event.createdAt,
    };
  }

  if (event.eventType === 'step.status.changed') {
    const payload = event.payload as { to?: RunStepStatus };
    return {
      ...(existing ?? { stepId: event.stepId, runId: event.runId }),
      status: payload.to ?? existing?.status ?? 'running',
      updatedAt: event.createdAt,
    };
  }

  if (event.eventType === 'step.completed') {
    const payload = event.payload as { kind?: RunStepKind };
    return {
      ...(existing ?? { stepId: event.stepId, runId: event.runId }),
      kind: payload.kind ?? existing?.kind,
      status: 'succeeded',
      updatedAt: event.createdAt,
    };
  }

  if (event.eventType === 'step.failed') {
    const payload = event.payload as { kind?: RunStepKind; error?: { message?: string } };
    return {
      ...(existing ?? { stepId: event.stepId, runId: event.runId }),
      kind: payload.kind ?? existing?.kind,
      status: 'failed',
      updatedAt: event.createdAt,
      errorMessage: payload.error?.message ?? existing?.errorMessage,
    };
  }

  return null;
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
  if (events.some((item) => item.eventId === event.eventId)) {
    return events;
  }
  return [...events, event].sort((left, right) => left.sequence - right.sequence);
}

export const useRunStore = create<RunState>((set) => ({
  activeRunId: null,
  runs: {},
  eventsByRun: {},
  stepsByRun: {},
  lastError: null,
  setActiveRun: (activeRunId) => set({ activeRunId }),
  applyRuntimeEvent: (event) => set((state) => {
    if (!event.runId) {
      return state;
    }

    const nextStatus = statusFromEvent(event);
    const existing = state.runs[event.runId];
    const existingStep = event.stepId ? state.stepsByRun[event.runId]?.[event.stepId] : undefined;
    const nextStep = stepSummaryFromEvent(event, existingStep);
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
      stepsByRun: nextStep
        ? {
            ...state.stepsByRun,
            [event.runId]: {
              ...(state.stepsByRun[event.runId] ?? {}),
              [nextStep.stepId]: nextStep,
            },
          }
        : state.stepsByRun,
      lastError: event.eventType === 'run.failed'
        ? ((event.payload as { error?: { message?: string } }).error?.message ?? 'Run failed.')
        : state.lastError,
    };
  }),
  resetRuns: () => set({
    activeRunId: null,
    runs: {},
    eventsByRun: {},
    stepsByRun: {},
    lastError: null,
  }),
}));
