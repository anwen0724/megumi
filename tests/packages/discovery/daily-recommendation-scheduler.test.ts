/* Verifies Daily Recommendation wall-clock scheduling delegates every trigger to one Runtime entry. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createDailyRecommendationScheduler,
} from '../../../packages/agent/discovery/src/daily-recommendation/daily-recommendation-scheduler';

describe('DailyRecommendationScheduler', () => {
  it('runs startup catch-up after today generation time and schedules the next local day', async () => {
    const ensure = vi.fn(async () => undefined);
    const setTimeout = vi.fn(() => 'timer:1');
    const clearTimeout = vi.fn();
    const scheduler = createDailyRecommendationScheduler({
      now: () => '2026-08-27T09:00:00.000Z',
      timezone: () => 'UTC',
      generationTime: () => '08:00',
      ensure,
      onScheduledError: vi.fn(),
      timers: { setTimeout, clearTimeout },
    });

    await scheduler.start();

    expect(ensure).toHaveBeenCalledWith({
      trigger: 'startup_catchup', now: '2026-08-27T09:00:00.000Z',
    });
    expect(scheduler.getNextScheduledAt()).toBe('2026-08-28T08:00:00.000Z');
    expect(setTimeout).toHaveBeenCalledOnce();
    await scheduler.shutdown();
    expect(clearTimeout).toHaveBeenCalledWith('timer:1');
  });

  it('does not catch up before today generation time', async () => {
    const ensure = vi.fn(async () => undefined);
    const scheduler = createDailyRecommendationScheduler({
      now: () => '2026-08-27T07:00:00.000Z',
      timezone: () => 'UTC',
      generationTime: () => '08:00',
      ensure,
      onScheduledError: vi.fn(),
      timers: { setTimeout: vi.fn(() => 'timer:1'), clearTimeout: vi.fn() },
    });

    await scheduler.start();

    expect(ensure).not.toHaveBeenCalled();
    expect(scheduler.getNextScheduledAt()).toBe('2026-08-27T08:00:00.000Z');
    await scheduler.shutdown();
  });
});
