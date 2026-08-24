/* Verifies provider-cost budgets are enforced before a source network call. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDailyDiscoveryAttempts, createSourceRegistry, type DiscoverySource } from '@megumi/discovery';

describe('daily discovery source budgets', () => {
  it('caps Twitter calls, each requested limit, and cumulative returned tweets', async () => {
    const search = vi.fn(async ({ limit }: { readonly limit: number }) => ({
      status: 'success' as const,
      items: Array.from({ length: limit }, (_, index) => ({
        sourceId: 'twitter', sourceName: 'X (Twitter)', sourceContentId: `${search.mock.calls.length}:${index}`,
        canonicalUrl: `https://x.com/example/status/${search.mock.calls.length}${index}`,
        contentType: 'post' as const, title: `Tweet ${index}`,
      })),
    }));
    const twitter: DiscoverySource = {
      descriptor: {
        id: 'twitter', name: 'X (Twitter)', access: 'configured_provider',
        supportedModes: ['relevance', 'recent'], supportsRead: false,
      },
      getAvailability: () => ({ state: 'ready' }),
      search,
    };
    const attempts = createDailyDiscoveryAttempts();
    attempts.start({
      executionId: 'execution:1', targetCount: 20, descriptors: [twitter.descriptor], signals: [],
      sourceRegistry: createSourceRegistry([twitter]),
      sourceBudgets: {
        twitter: { maxSearchCalls: 2, maxResultsPerSearch: 4, maxResultsPerAttempt: 6 },
      },
    });

    const invoke = (limit: number) => attempts.searchContent({
      executionId: 'execution:1',
      input: { sourceId: 'twitter', query: 'Agent', mode: 'recent', limit },
      signal: new AbortController().signal,
    });
    await invoke(20);
    await invoke(20);
    const exhausted = await invoke(1);

    expect(search.mock.calls.map(([request]) => request.limit)).toEqual([4, 2]);
    expect(exhausted).toMatchObject({
      isError: true,
      content: { status: 'failed', code: 'source_budget_exhausted' },
    });
    expect(search).toHaveBeenCalledTimes(2);
  });
});
