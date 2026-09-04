/* Verifies explicit business time without running unrelated future timers. */
import { describe, expect, it } from 'vitest';
import { createControlledClock } from '../../evals/agent/adapters/controlled/clock';

describe('Controlled clock', () => {
  it('runs only due timers in order, honors cancellation, and awaits active business work', async () => {
    const clock = createControlledClock('2026-01-15T08:00:00.000Z');
    const calls: string[] = [];
    let active = false;
    clock.timers.setTimeout(() => { calls.push(clock.now()); active = true; }, 600_000);
    const cancelled = clock.timers.setTimeout(() => calls.push('cancelled'), 100);
    clock.timers.clearTimeout(cancelled);
    clock.timers.setTimeout(() => calls.push(clock.now()), 900_000);
    await clock.advanceBy(660_000, async () => {
      if (active) { expect(clock.now()).toBe('2026-01-15T08:10:00.000Z'); active = false; }
    });
    expect(calls).toEqual(['2026-01-15T08:10:00.000Z']);
    expect(clock.now()).toBe('2026-01-15T08:11:00.000Z');
  });
});
