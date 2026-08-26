/*
 * Owns the single-process FIFO and one-worker lifecycle for Interest extraction.
 */
export interface InterestExtractionJob {
  readonly sessionId: string;
  readonly executionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly completedAt: string;
  readonly sequence: number;
}

export interface InterestExtractionQueue {
  /** Appends one job when the queue still accepts work. */
  submit(job: Omit<InterestExtractionJob, 'sequence'>): InterestExtractionJob | undefined;
  /** Stops acceptance, cancels active work, and drains the owned worker. */
  shutdown(): Promise<void>;
}

/** Creates the owned single-worker queue for post-conversation Interest extraction. */
export function createInterestExtractionQueue(options: {
  readonly process: (job: InterestExtractionJob, signal: AbortSignal) => Promise<void>;
  readonly onError?: (error: unknown, job: InterestExtractionJob) => void;
}): InterestExtractionQueue {
  const pending: InterestExtractionJob[] = [];
  let accepting = true;
  let worker: Promise<void> | undefined;
  let sequence = 0;
  let activeController: AbortController | undefined;

  /** Serially drains accepted jobs while keeping the worker Promise owned by this queue. */
  const drain = async (): Promise<void> => {
    try {
      while (accepting && pending.length > 0) {
        const job = pending.shift();
        if (!job) break;
        const controller = new AbortController();
        activeController = controller;
        try {
          await options.process(job, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) {
            try {
              options.onError?.(error, job);
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
      pending.push(job);
      startWorker();
      return job;
    },
    async shutdown() {
      accepting = false;
      pending.length = 0;
      activeController?.abort();
      await worker;
    },
  };
}
