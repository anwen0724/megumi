/* Owns the single-process FIFO and one-worker lifecycle for Interest extraction. */
export interface InterestExtractionJob {
  readonly sessionId: string;
  readonly executionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly completedAt: string;
  readonly sequence: number;
}

export interface InterestExtractionQueue {
  submit(job: Omit<InterestExtractionJob, 'sequence'>): InterestExtractionJob | undefined;
  shutdown(): Promise<void>;
}

export function createInterestExtractionQueue(options: {
  readonly process: (job: InterestExtractionJob, signal: AbortSignal) => Promise<void>;
  readonly onError?: (error: unknown, job: InterestExtractionJob) => void;
}): InterestExtractionQueue {
  const pending: InterestExtractionJob[] = [];
  let accepting = true;
  let worker: Promise<void> | undefined;
  let sequence = 0;
  let activeController: AbortController | undefined;

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
