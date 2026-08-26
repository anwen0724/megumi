/*
 * Owns bounded asynchronous diagnostic writes with stable ordering and priority-based eviction.
 */
export type ObservabilityWritePriority = 'content' | 'event' | 'lifecycle' | 'runtime';

export interface ObservabilityWriteJob {
  readonly id: string;
  readonly priority: ObservabilityWritePriority;
  readonly byteLength: number;
  readonly terminal: boolean;
  readonly write: () => Promise<void>;
}

export interface ObservabilityWriteQueueSnapshot {
  readonly queuedJobs: number;
  readonly queuedBytes: number;
  readonly highWaterBytes: number;
  readonly stopped: boolean;
}

export interface ObservabilityWriteQueue {
  /** Accepts a job synchronously or drops it according to fixed priority and capacity. */
  enqueue(job: ObservabilityWriteJob): boolean;
  /** Drains every accepted job present before the flush completes. */
  flush(): Promise<void>;
  /** Stops accepting jobs after draining all accepted work. */
  shutdown(): Promise<void>;
  /** Returns bounded in-process queue health. */
  snapshot(): ObservabilityWriteQueueSnapshot;
}

export interface CreateObservabilityWriteQueueOptions {
  readonly capacityBytes: number;
  readonly drainIntervalMs: number;
  readonly onDrop?: (job: ObservabilityWriteJob) => void;
  readonly onWriteFailure?: (job: ObservabilityWriteJob) => void;
}

const PRIORITY_RANK: Readonly<Record<ObservabilityWritePriority, number>> = {
  content: 0,
  event: 1,
  runtime: 2,
  lifecycle: 3,
};

/** Creates one in-order queue whose worker owns and observes every write Promise. */
export function createObservabilityWriteQueue(
  options: CreateObservabilityWriteQueueOptions,
): ObservabilityWriteQueue {
  const jobs: ObservabilityWriteJob[] = [];
  let queuedBytes = 0;
  let highWaterBytes = 0;
  let drainPromise: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const notifyDrop = (job: ObservabilityWriteJob): void => {
    try {
      options.onDrop?.(job);
    } catch {
      // Health reporting must not make queue admission throw.
    }
  };

  const scheduleDrain = (): void => {
    if (timer || stopped || jobs.length === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      void startDrain();
    }, options.drainIntervalMs);
    timer.unref?.();
  };

  const startDrain = (): Promise<void> => {
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      while (jobs.length > 0) {
        const job = jobs.shift();
        if (!job) continue;
        queuedBytes -= job.byteLength;
        try {
          await job.write();
        } catch {
          try {
            options.onWriteFailure?.(job);
          } catch {
            // Failure reporting cannot reject the owned worker Promise.
          }
        }
      }
    })().finally(() => {
      drainPromise = undefined;
      if (jobs.length > 0) scheduleDrain();
    });
    return drainPromise;
  };

  const cancelTimer = (): void => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  };

  return {
    enqueue(job) {
      if (stopped || job.byteLength < 0 || job.byteLength > options.capacityBytes) {
        notifyDrop(job);
        return false;
      }

      while (queuedBytes + job.byteLength > options.capacityBytes) {
        const evictionIndex = jobs.findIndex((candidate) => (
          PRIORITY_RANK[candidate.priority] < PRIORITY_RANK[job.priority]
        ));
        if (evictionIndex < 0) {
          notifyDrop(job);
          return false;
        }
        const evicted = jobs.splice(evictionIndex, 1)[0];
        if (evicted) {
          queuedBytes -= evicted.byteLength;
          notifyDrop(evicted);
        }
      }

      jobs.push(job);
      queuedBytes += job.byteLength;
      highWaterBytes = Math.max(highWaterBytes, queuedBytes);
      if (job.terminal) {
        cancelTimer();
        void startDrain();
      } else {
        scheduleDrain();
      }
      return true;
    },

    async flush() {
      cancelTimer();
      do {
        await startDrain();
      } while (jobs.length > 0 || drainPromise);
    },

    async shutdown() {
      await this.flush();
      stopped = true;
      cancelTimer();
    },

    snapshot: () => ({
      queuedJobs: jobs.length,
      queuedBytes,
      highWaterBytes,
      stopped,
    }),
  };
}
