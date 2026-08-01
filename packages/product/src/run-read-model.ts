/*
 * Keeps the Product-owned, bounded Run/Event projection used by hosts and
 * Product shutdown coordination. It is not the durable Session history.
 */
import type { RuntimeEvent } from '@megumi/events';
import type { Run } from '@megumi/engine';

const DEFAULT_MAX_RUNS = 256;
const DEFAULT_MAX_EVENTS_PER_RUN = 512;
const DEFAULT_TERMINAL_RETENTION_MS = 300_000;

export class ProductRunReadModel {
  private readonly runsById = new Map<string, Run>();
  private readonly eventsByRunId = new Map<string, RuntimeEvent[]>();
  private readonly liveRunIds = new Set<string>();
  private readonly terminalRecordedAt = new Map<string, number>();
  private readonly convergenceWaiters = new Set<() => void>();

  constructor(
    private readonly options: {
      maxRuns?: number;
      maxEventsPerRun?: number;
      terminalRetentionMs?: number;
      nowMs?: () => number;
    } = {},
  ) {}

  recordRun(run: Run): void {
    this.runsById.delete(run.runId);
    this.runsById.set(run.runId, run);
    if (isTerminal(run.status)) {
      this.liveRunIds.delete(run.runId);
      this.terminalRecordedAt.set(run.runId, this.nowMs());
    } else {
      this.terminalRecordedAt.delete(run.runId);
      this.liveRunIds.add(run.runId);
    }
    this.prune();
    this.notifyConvergence();
  }

  recordEvent(event: RuntimeEvent): void {
    if (!event.runId) return;
    const events = this.eventsByRunId.get(event.runId) ?? [];
    events.push(event);
    const maxEvents = this.options.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN;
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    this.eventsByRunId.set(event.runId, events);

    const current = this.runsById.get(event.runId);
    const status = statusFromRuntimeEvent(event.eventType);
    if (current && status) {
      this.recordRun({
        ...current,
        status,
        ...(isTerminal(status) ? { completedAt: event.createdAt } : {}),
      });
    }
  }

  getRun(runId: string): Run | undefined {
    this.prune();
    return this.runsById.get(runId);
  }

  listRunsBySession(sessionId: string): readonly Run[] {
    this.prune();
    return [...this.runsById.values()].filter((run) => run.sessionId === sessionId);
  }

  listEventsByRun(runId: string): readonly RuntimeEvent[] {
    this.prune();
    return [...(this.eventsByRunId.get(runId) ?? [])];
  }

  listLiveRunIds(): readonly string[] {
    return [...this.liveRunIds];
  }

  async waitForConvergence(timeoutMs: number): Promise<boolean> {
    if (this.liveRunIds.size === 0) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (converged: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.convergenceWaiters.delete(onConverged);
        resolve(converged);
      };
      const onConverged = () => finish(true);
      const timeout = setTimeout(() => finish(false), timeoutMs);
      this.convergenceWaiters.add(onConverged);
    });
  }

  private notifyConvergence(): void {
    if (this.liveRunIds.size !== 0) return;
    for (const waiter of [...this.convergenceWaiters]) waiter();
  }

  private prune(): void {
    const now = this.nowMs();
    const retention = this.options.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
    for (const [runId, recordedAt] of this.terminalRecordedAt) {
      if (now - recordedAt >= retention) this.remove(runId);
    }

    const maxRuns = this.options.maxRuns ?? DEFAULT_MAX_RUNS;
    if (this.runsById.size <= maxRuns) return;
    for (const [runId, run] of this.runsById) {
      if (this.runsById.size <= maxRuns) break;
      if (isTerminal(run.status)) this.remove(runId);
    }
  }

  private remove(runId: string): void {
    this.runsById.delete(runId);
    this.eventsByRunId.delete(runId);
    this.terminalRecordedAt.delete(runId);
    this.liveRunIds.delete(runId);
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? Date.now();
  }
}

function isTerminal(status: Run['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function statusFromRuntimeEvent(eventType: RuntimeEvent['eventType']): Run['status'] | undefined {
  if (eventType === 'run.started' || eventType === 'run.resumed') return 'running';
  if (eventType === 'run.waiting') return 'waiting';
  if (eventType === 'run.cancelling' || eventType === 'run.cancel.requested') return 'cancelling';
  if (eventType === 'run.completed') return 'completed';
  if (eventType === 'run.failed') return 'failed';
  if (eventType === 'run.cancelled') return 'cancelled';
  return undefined;
}
