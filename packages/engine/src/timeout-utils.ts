/*
 * Shares the settled-flag race helpers used by ModelCall attempts and Tool executions:
 * one promise-vs-timeout race and one abort-or-timeout interruption signal.
 */

export type InterruptionReason = 'abort' | 'cancelled' | 'timeout';

export interface InterruptionHandle {
  readonly result: Promise<{ readonly type: 'interrupted'; readonly reason: InterruptionReason }>;
  readonly dispose: () => void;
}

/**
 * Resolves with the first settlement of `task`, or `'timed_out'` once `timeoutMs` elapses.
 * A `task` rejection propagates; callers attach their own rejection mapping when needed.
 */
export async function raceWithTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
): Promise<T | 'timed_out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<'timed_out'>((resolve) => {
        timer = setTimeout(() => resolve('timed_out'), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolves once `runSignal` aborts (as `abortReason`) or the timeout elapses (as `'timeout'`,
 * aborting `timeoutController` in the process). Callers must dispose the handle.
 */
export function createInterruption(input: {
  readonly runSignal: AbortSignal;
  readonly timeoutController: AbortController;
  readonly timeoutMs: number;
  readonly abortReason: 'abort' | 'cancelled';
}): InterruptionHandle {
  let settled = false;
  let resolve!: (result: { readonly type: 'interrupted'; readonly reason: InterruptionReason }) => void;
  const result = new Promise<{ readonly type: 'interrupted'; readonly reason: InterruptionReason }>(
    (complete) => {
      resolve = complete;
    },
  );
  const finish = (reason: InterruptionReason) => {
    if (settled) return;
    settled = true;
    resolve({ type: 'interrupted', reason });
  };
  const onAbort = () => finish(input.abortReason);
  input.runSignal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    finish('timeout');
    input.timeoutController.abort();
  }, input.timeoutMs);

  if (input.runSignal.aborted) finish(input.abortReason);

  return {
    result,
    dispose: () => {
      clearTimeout(timeout);
      input.runSignal.removeEventListener('abort', onAbort);
    },
  };
}
