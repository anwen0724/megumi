// Tracks in-flight session message runs owned by the Coding Agent state boundary.
import type { Run } from '@megumi/shared/session';

export interface ActiveSessionMessageRunRef {
  sessionId: string;
  runId: string;
  stepId: string;
}

export interface ActiveSessionMessageRunHandle<TProjection = unknown> extends ActiveSessionMessageRunRef {
  projection?: TProjection;
}

export interface TrackActiveSessionMessageRunInput<TEvent> {
  requestId: string;
  events: AsyncIterable<TEvent>;
  getRunStatus(runId: string): Run['status'] | undefined;
}

export class ActiveSessionMessageRunTracker<TProjection = unknown> {
  private readonly activeRuns = new Map<string, ActiveSessionMessageRunHandle<TProjection>>();

  register(requestId: string, activeRun: ActiveSessionMessageRunHandle<TProjection>): void {
    this.activeRuns.set(requestId, activeRun);
  }

  get(requestId: string): ActiveSessionMessageRunHandle<TProjection> | undefined {
    return this.activeRuns.get(requestId);
  }

  forget(requestId: string): void {
    this.activeRuns.delete(requestId);
  }

  async *track<TEvent>(
    input: TrackActiveSessionMessageRunInput<TEvent>,
  ): AsyncIterable<TEvent> {
    try {
      yield* input.events;
    } finally {
      const activeRun = this.activeRuns.get(input.requestId);
      const status = activeRun ? input.getRunStatus(activeRun.runId) : undefined;
      if (status !== 'waiting_for_approval') {
        this.activeRuns.delete(input.requestId);
      }
    }
  }
}
