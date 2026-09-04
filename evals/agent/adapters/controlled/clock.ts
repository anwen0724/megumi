/* Keeps the controlled business clock and scheduled callbacks on the same timeline. */
export function createControlledClock(initialTime: string) {
  let current = Date.parse(initialTime);
  if (!Number.isFinite(current)) throw new Error('Invalid controlled clock.');
  let sequence = 0;
  let advancing = false;
  const pending = new Map<number, { readonly dueAt: number; readonly callback: () => void }>();
  return {
    now: () => new Date(current).toISOString(),
    timers: {
      setTimeout(callback: () => void, delayMs: number): unknown {
        if (!Number.isFinite(delayMs)) throw new Error('Invalid controlled timer delay.');
        const handle = ++sequence;
        pending.set(handle, { dueAt: current + Math.max(0, delayMs), callback });
        return handle;
      },
      clearTimeout(handle: unknown): void { if (typeof handle === 'number') pending.delete(handle); },
    },
    async advanceBy(durationMs: number, waitForIdle: () => Promise<void>): Promise<void> {
      if (!Number.isSafeInteger(durationMs) || durationMs < 0 || advancing) throw new Error('Invalid or concurrent controlled time advance.');
      advancing = true;
      const target = current + durationMs;
      try {
        for (;;) {
          // Business work may schedule more timers. Never jump during an active model/tool operation.
          await waitForIdle();
          const next = [...pending.entries()].filter(([, timer]) => timer.dueAt <= target)
            .sort(([firstId, first], [secondId, second]) => first.dueAt - second.dueAt || firstId - secondId)[0];
          if (!next) { current = target; return; }
          const [handle, timer] = next;
          pending.delete(handle);
          current = timer.dueAt;
          timer.callback();
        }
      } finally { advancing = false; }
    },
  };
}
