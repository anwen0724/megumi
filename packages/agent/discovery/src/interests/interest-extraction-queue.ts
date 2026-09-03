/*
 * Owns the single-process FIFO and one-worker lifecycle for Interest extraction.
 */
export interface InterestExtractionJob {
  readonly sessionId: string;
  readonly executionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly completedAt: string;
  readonly queuedAt: string;
  readonly sequence: number;
}

export interface InterestExtractionOutcome {
  readonly outcome: 'evidence_committed' | 'no_durable_evidence';
  readonly changedInterestIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface InterestExtractionQueue {
  /** Appends one job when the queue still accepts work. */
  submit(job: Omit<InterestExtractionJob, 'sequence'>): InterestExtractionJob | undefined;
  /** Stops acceptance, cancels active work, and drains the owned worker. */
  shutdown(): Promise<void>;
}

/** Creates the owned single-worker queue for post-conversation Interest extraction. */
export function createInterestExtractionQueue(options: {
  readonly process: (
    job: InterestExtractionJob,
    signal: AbortSignal,
  ) => Promise<InterestExtractionOutcome>;
  /** Starts diagnostic observation at acceptance, before the worker releases this job. */
  readonly observe?: (
    job: InterestExtractionJob,
    operation: () => Promise<InterestExtractionOutcome>,
  ) => Promise<InterestExtractionOutcome>;
  readonly onError?: (error: unknown, job: InterestExtractionJob) => void;
}): InterestExtractionQueue {
  interface PendingJob {
    readonly job: InterestExtractionJob;
    start(signal: AbortSignal): Promise<InterestExtractionOutcome>;
  }

  const pending: PendingJob[] = [];
  let accepting = true;
  let worker: Promise<void> | undefined;
  let sequence = 0;
  let activeController: AbortController | undefined;

  /** Serially drains accepted jobs while keeping the worker Promise owned by this queue. */
  const drain = async (): Promise<void> => {
    try {
      while (accepting && pending.length > 0) {
        const pendingJob = pending.shift();
        if (!pendingJob) break;
        const controller = new AbortController();
        activeController = controller;
        try {
          await pendingJob.start(controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) {
            try {
              options.onError?.(error, pendingJob.job);
            } catch {
              // An error observer cannot create a second unobserved worker failure.
            }
          }
        } finally {
          if (activeController === controller) activeController = undefined;
        }
      }
    } finally {
      worker = undefined;
      if (accepting && pending.length > 0) startWorker();
    }
  };

  const startWorker = (): void => {
    if (worker) return;
    worker = drain();
  };

  return {
    submit(input) {
      if (!accepting) return undefined;
      const job = Object.freeze({ ...input, sequence: ++sequence });
      let startProcessing: ((signal: AbortSignal) => void) | undefined;
      const signal = new Promise<AbortSignal>((resolve) => { startProcessing = resolve; });
      const operation = async () => options.process(job, await signal);
      const completion = options.observe ? options.observe(job, operation) : operation();
      pending.push({
        job,
        start(nextSignal) {
          startProcessing?.(nextSignal);
          startProcessing = undefined;
          return completion;
        },
      });
      startWorker();
      return job;
    },
    async shutdown() {
      accepting = false;
      const interrupted = pending.splice(0);
      const interruptedWork = interrupted.map((pendingJob) => {
        const controller = new AbortController();
        controller.abort();
        return pendingJob.start(controller.signal);
      });
      activeController?.abort();
      await Promise.allSettled([...(worker ? [worker] : []), ...interruptedWork]);
    },
  };
}
