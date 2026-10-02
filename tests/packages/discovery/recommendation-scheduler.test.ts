/* Verifies Recommendation wall-clock scheduling delegates every trigger to one Runtime entry. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createRecommendationScheduler } from '@megumi/application/discovery/scheduling/recommendation-scheduler';

describe('RecommendationScheduler', () => {
  it('runs startup catch-up after today generation time and schedules the next local day', async () => {
    const ensure = vi.fn(async () => undefined);
    const setTimeout = vi.fn(() => 'timer:1');
    const clearTimeout = vi.fn();
    const scheduler = createRecommendationScheduler({
      now: () => '2026-08-27T09:00:00.000Z',
      timezone: () => 'UTC',
      generationTime: () => '08:00',
      ensure,
      onScheduledError: vi.fn(),
      timers: { setTimeout, clearTimeout },
    });

    await scheduler.start();

    expect(ensure).toHaveBeenCalledWith({
      trigger: 'startup_catchup',
    });
    expect(scheduler.getNextScheduledAt()).toBe('2026-08-28T08:00:00.000Z');
    expect(setTimeout).toHaveBeenCalledOnce();
    await scheduler.shutdown();
    expect(clearTimeout).toHaveBeenCalledWith('timer:1');
  });

  it('does not catch up before today generation time', async () => {
    const ensure = vi.fn(async () => undefined);
    const scheduler = createRecommendationScheduler({
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

it('applies a changed generation time to the running schedule', async () => {
  let time = '08:00';
  const scheduler = createRecommendationScheduler({
    now: () => '2026-08-27T07:00:00.000Z',
    timezone: () => 'UTC',
    generationTime: () => time,
    ensure: async () => undefined,
    onScheduledError: (error) => {
      throw error;
    },
    timers: { setTimeout: () => 1, clearTimeout: () => undefined },
  });
  await scheduler.start();
  time = '09:30';
  scheduler.updateSchedule();
  expect(scheduler.getNextScheduledAt()).toBe('2026-08-27T09:30:00.000Z');
  await scheduler.shutdown();
});
