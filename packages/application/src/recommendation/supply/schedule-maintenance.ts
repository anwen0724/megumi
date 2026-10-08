/*
 * Owns when maintenance runs: once at startup, then again one interval after
 * the previous round finished. A timer that came due while the machine slept
 * fires once on resume rather than replaying every missed period.
 */

export interface MaintenanceSchedulerOptions {
  readonly supply: {
    startMaintenance(input: { reason: 'startup' | 'periodic' }): { result: Promise<unknown> };
    close(): Promise<void>;
  };
  /** Interval measured from the end of the previous round. */
  readonly intervalMs: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Reported when a round rejects; the scheduler keeps its cadence. */
  readonly onError?: (error: unknown) => void;
}

export interface MaintenanceScheduler {
  /** Runs the startup round and arranges the next periodic one. */
  start(): void;
  /** Cancels the pending timer and closes the supply service. */
  stop(): Promise<void>;
}

export function createMaintenanceScheduler(
  options: MaintenanceSchedulerOptions,
): MaintenanceScheduler {
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  let handle: unknown;
  let stopped = false;
  let started = false;

  return {
    start() {
      if (stopped || started) return;

      started = true;
      void runRound('startup');
    },

    async stop() {
      if (stopped) return;

      stopped = true;
      if (handle !== undefined)
        (options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>)))(
          handle,
        );

      handle = undefined;
      await options.supply.close();
    },
  };

  async function runRound(reason: 'startup' | 'periodic'): Promise<void> {
    if (stopped) return;

    handle = undefined;

    try {
      await options.supply.startMaintenance({ reason }).result;
    } catch (error) {
      options.onError?.(error);
    }

    schedule();
  }

  /** The next round is measured from this moment, so a long round delays it. */
  function schedule(): void {
    if (stopped) return;

    handle = setTimer(() => {
      void runRound('periodic');
    }, options.intervalMs());
  }
}
