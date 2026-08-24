/* Verifies execution-scoped browser task claim, completion, timeout, and cancellation. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBrowserSourceTaskManager } from '../../../../../apps/desktop/src/main/adapters/browser-source/browser-source-task-manager';

describe('BrowserSourceTaskManager', () => {
  it('allows one claimant and accepts only its one-time claim token', async () => {
    const manager = createBrowserSourceTaskManager({ createId: sequenceIds(), timeoutMs: 5_000 });
    const execution = manager.execute(
      { sourceId: 'zhihu', operation: 'search', query: 'Agent', mode: 'relevance', limit: 5 },
      { signal: new AbortController().signal },
    );
    const claimed = manager.claim('zhihu');
    expect(claimed?.task.request.query).toBe('Agent');
    expect(manager.claim('zhihu')).toBeUndefined();
    expect(() => manager.complete(claimed!.task.taskId, 'wrong', { status: 'success', items: [] })).toThrow(/claim token/i);
    manager.complete(claimed!.task.taskId, claimed!.claimToken, { status: 'success', items: [] });
    await expect(execution).resolves.toEqual({ status: 'success', items: [] });
  });

  it('cancels pending work and rejects late results', async () => {
    const manager = createBrowserSourceTaskManager({ createId: sequenceIds(), timeoutMs: 5_000 });
    const controller = new AbortController();
    const execution = manager.execute(
      { sourceId: 'douyin', operation: 'search', query: '美食', mode: 'relevance', limit: 5 },
      { signal: controller.signal },
    );
    const claimed = manager.claim('douyin')!;
    controller.abort();
    await expect(execution).resolves.toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    expect(() => manager.complete(claimed.task.taskId, claimed.claimToken, { status: 'success', items: [] }))
      .toThrow(/not found|cancelled/i);
  });

  it('expires tasks at the gateway deadline', async () => {
    vi.useFakeTimers();
    const manager = createBrowserSourceTaskManager({ createId: sequenceIds(), timeoutMs: 75_000 });
    const execution = manager.execute(
      { sourceId: 'xiaohongshu', operation: 'search', query: '穿搭', mode: 'relevance', limit: 5 },
      { signal: new AbortController().signal },
    );
    await vi.advanceTimersByTimeAsync(75_000);
    await expect(execution).resolves.toMatchObject({ status: 'failed', failure: { code: 'timeout' } });
    vi.useRealTimers();
  });
});

function sequenceIds(): () => string {
  let next = 0;
  return () => `id:${++next}`;
}
