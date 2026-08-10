/* Coordinates the one permitted replacement input without introducing a general input queue. */
export interface CancelAndReplaceCoordinator {
  begin(activeRunId?: string): Promise<boolean>;
  accept(text: string): Promise<boolean>;
  clear(): void;
  readonly pending: boolean;
}

export function createCancelAndReplaceCoordinator(input: {
  readonly interruptSpeech: () => Promise<void>;
  readonly cancelRun: (runId: string) => Promise<boolean>;
  readonly waitForCancelled: (runId: string) => Promise<void>;
  readonly submit: (text: string) => Promise<void>;
}): CancelAndReplaceCoordinator {
  let pendingRunId: string | undefined;
  let accepting = false;
  let started = false;

  return {
    get pending() { return started; },
    async begin(activeRunId) {
      if (started) return false;
      started = true;
      try {
        await input.interruptSpeech();
        if (activeRunId) {
          const cancellationRequested = await input.cancelRun(activeRunId);
          if (!cancellationRequested) {
            started = false;
            return false;
          }
          pendingRunId = activeRunId;
        }
        return true;
      } catch (error) {
        started = false;
        pendingRunId = undefined;
        throw error;
      }
    },
    async accept(text) {
      if (!started || accepting || !text.trim()) return false;
      accepting = true;
      try {
        if (pendingRunId) await input.waitForCancelled(pendingRunId);
        await input.submit(text.trim());
        return true;
      } finally {
        accepting = false;
        started = false;
        pendingRunId = undefined;
      }
    },
    clear() {
      started = false;
      accepting = false;
      pendingRunId = undefined;
    },
  };
}
