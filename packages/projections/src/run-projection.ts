/*
 * Projects the bounded, host-facing Run and Runtime Event view exclusively
 * from the formal Runtime Event stream.
 */

import type { RuntimeEvent } from '@megumi/events';

const DEFAULT_MAX_RUNS = 256;
const DEFAULT_MAX_EVENTS_PER_RUN = 512;
const DEFAULT_TERMINAL_RETENTION_MS = 300_000;

export type ProjectedRunStatus =
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ProjectedRun {
  readonly runId: string;
  readonly workspaceId?: string;
  readonly sessionId: string;
  readonly status: ProjectedRunStatus;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface RunProjection {
  project(event: RuntimeEvent): void;
  getRun(request: { readonly runId: string }): ProjectedRun | undefined;
  listRuns(request: { readonly sessionId: string }): readonly ProjectedRun[];
  listEvents(request: { readonly runId: string }): readonly RuntimeEvent[];
  isRunLive(request: { readonly runId: string }): boolean;
}

export interface CreateRunProjectionRequest {
  readonly maxRuns?: number;
  readonly maxEventsPerRun?: number;
  readonly terminalRetentionMs?: number;
  readonly nowMs?: () => number;
}

export function createRunProjection(
  options: CreateRunProjectionRequest = {},
): RunProjection {
  const runsById = new Map<string, ProjectedRun>();
  const eventsByRunId = new Map<string, RuntimeEvent[]>();
  const terminalRecordedAt = new Map<string, number>();
  const nowMs = options.nowMs ?? Date.now;

  function remove(runId: string): void {
    runsById.delete(runId);
    eventsByRunId.delete(runId);
    terminalRecordedAt.delete(runId);
  }

  function prune(): void {
    const now = nowMs();
    const retention = options.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
    for (const [runId, recordedAt] of terminalRecordedAt) {
      if (now - recordedAt >= retention) remove(runId);
    }
    const maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;
    if (runsById.size <= maxRuns) return;
    for (const [runId, run] of runsById) {
      if (runsById.size <= maxRuns) break;
      if (isTerminal(run.status)) remove(runId);
    }
  }

  return {
    project(event) {
      if (!event.runId) return;
      const events = eventsByRunId.get(event.runId) ?? [];
      events.push(structuredClone(event));
      const maxEvents = options.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN;
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
      eventsByRunId.set(event.runId, events);

      const status = statusFromRuntimeEvent(event.eventType);
      if (status && event.sessionId) {
        const current = runsById.get(event.runId);
        const projected: ProjectedRun = {
          runId: event.runId,
          ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
          sessionId: event.sessionId,
          status,
          createdAt: current?.createdAt ?? event.createdAt,
          ...(isTerminal(status) ? { completedAt: event.createdAt } : {}),
        };
        runsById.delete(event.runId);
        runsById.set(event.runId, projected);
        if (isTerminal(status)) terminalRecordedAt.set(event.runId, nowMs());
        else terminalRecordedAt.delete(event.runId);
      }
      prune();
    },

    getRun({ runId }) {
      prune();
      const run = runsById.get(runId);
      return run ? structuredClone(run) : undefined;
    },

    listRuns({ sessionId }) {
      prune();
      return [...runsById.values()]
        .filter((run) => run.sessionId === sessionId)
        .map((run) => structuredClone(run));
    },

    listEvents({ runId }) {
      prune();
      return structuredClone(eventsByRunId.get(runId) ?? []);
    },

    isRunLive({ runId }) {
      prune();
      const run = runsById.get(runId);
      return run !== undefined && !isTerminal(run.status);
    },
  };
}

function isTerminal(status: ProjectedRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function statusFromRuntimeEvent(
  eventType: RuntimeEvent['eventType'],
): ProjectedRunStatus | undefined {
  if (eventType === 'run.started' || eventType === 'run.resumed') return 'running';
  if (eventType === 'run.waiting') return 'waiting';
  if (eventType === 'run.cancelling' || eventType === 'run.cancel.requested') return 'cancelling';
  if (eventType === 'run.completed') return 'completed';
  if (eventType === 'run.failed') return 'failed';
  if (eventType === 'run.cancelled') return 'cancelled';
  return undefined;
}
