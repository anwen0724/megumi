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
  shutdown(): void;
}

export function createInterestExtractionQueue(options: {
  readonly process: (job: InterestExtractionJob, signal: AbortSignal) => Promise<void>;
  readonly onError?: (error: unknown, job: InterestExtractionJob) => void;
}): InterestExtractionQueue {
  const pending: InterestExtractionJob[] = [];
  let accepting = true;
  let processing = false;
  let sequence = 0;
  let activeController: AbortController | undefined;

  const drain = async (): Promise<void> => {
    if (processing) return;
    processing = true;
    try {
      while (accepting && pending.length > 0) {
        const job = pending.shift()!;
        const controller = new AbortController();
        activeController = controller;
        try {
          await options.process(job, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) options.onError?.(error, job);
        } finally {
          if (activeController === controller) activeController = undefined;
        }
      }
    } finally {
      processing = false;
      if (accepting && pending.length > 0) void drain();
    }
  };

  return {
    submit(input) {
      if (!accepting) return undefined;
      const job = Object.freeze({ ...input, sequence: ++sequence });
      pending.push(job);
      void drain();
      return job;
    },
    shutdown() {
      accepting = false;
      pending.length = 0;
      activeController?.abort();
    },
  };
}
