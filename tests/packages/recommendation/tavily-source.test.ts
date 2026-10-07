/* Verifies Tavily protocol and actual acquired material without network access. */
// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createTavilySource } from '@megumi/application/recommendation/sources/tavily-source';

it('searches the fixed date window and keeps a snippet as a snippet', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
    results: [{
      title: 'React',
      url: 'https://example.com/react',
      content: '渲染流程',
      raw_content: null,
      published_date: '2026-10-06'
    }]
  }));
  const source = createTavilySource({ accessSecret: () => 'secret', fetch });
  const result = await source.search({
    query: 'React 面试',
    limit: 5,
    timeRange: { from: Date.parse('2026-10-04T00:00:00Z'), to: Date.parse('2026-10-07T00:00:00Z') }
  });
  expect(result).toMatchObject({
    status: 'success', items: [{
      source: 'tavily',
      platform: 'web',
      kind: 'excerpt',
      text: '渲染流程',
      publicationEvidence: [{ kind: 'published', value: '2026-10-06', status: 'unverified' }]
    }]
  });
  expect(fetch).toHaveBeenCalledWith(
    'https://api.tavily.com/search',
    expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer secret' }) })
  );
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({
    query: 'React 面试',
    search_depth: 'basic',
    include_answer: false,
    max_results: 5,
    start_date: '2026-10-04',
    end_date: '2026-10-07'
  });
});

it.each([
  [401, 'unauthorized'], [429, 'rate_limited'], [503, 'unavailable'],
] as const)('reports HTTP %s as %s instead of accepting a search payload', async (status, code) => {
  vi.useFakeTimers();
  try {
    const source = createTavilySource({ accessSecret: () => 'secret', fetch: async () => new Response('', { status, headers: { 'Retry-After': '17' } }) });
    const pending = source.search({ query: 'React', limit: 5 });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 'failed', failure: { code, ...(status === 429 ? { retryAfterMs: 17_000 } : {}) } });
  } finally { vi.useRealTimers(); }
});

it('retries transient API failure within the same physical request budget', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    let remaining = 2;
    const source = createTavilySource({ accessSecret: () => 'secret', fetch: async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ results: [{ title: '面试', url: 'https://example.com/1', content: '正文' }] }) });
    const pending = source.search({ query: '面试', limit: 1, reserveRequest: () => remaining-- > 0 });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 'success', items: [{ text: '正文' }] });
    expect(calls).toBe(2);
    expect(remaining).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('reports malformed, oversized and cancelled responses without exposing credentials', async () => {
  const responses = [new Response('<html>challenge</html>'), new Response('a'.repeat(2 * 1024 * 1024 + 1))];
  const source = createTavilySource({ accessSecret: () => 'secret', fetch: async () => responses.shift()! });
  expect(await source.search({ query: 'React', limit: 5 })).toMatchObject({ status: 'failed', failure: { code: 'invalid_response' } });
  expect(await source.search({ query: 'React', limit: 5 })).toMatchObject({ status: 'failed', failure: { code: 'material_too_large' } });
  const controller = new AbortController(); controller.abort();
  expect(await source.search({ query: 'React', limit: 5, signal: controller.signal })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
});

it('keeps per-URL extract failure separate from HTTP success and saves actual extracted text', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ results: [{ url: 'https://example.com/ok', raw_content: '完整材料' }], failed_results: [{ url: 'https://example.com/missing', error: 'Unavailable' }] }));
  const source = createTavilySource({ accessSecret: () => 'secret', fetch });
  expect(await source.fetch({ url: 'https://example.com/missing' })).toMatchObject({ status: 'failed', failure: { code: 'material_unavailable' } });
  expect(await source.fetch({ url: 'https://example.com/ok' })).toMatchObject({ status: 'success', material: { text: '完整材料', kind: 'full_text', method: 'tavily_extract', rangeEnd: 4 } });
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ urls: ['https://example.com/missing'], format: 'markdown' });
});

it('finishes cancellation while the transport has not returned a response', async () => {
  const controller = new AbortController();
  let started: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const source = createTavilySource({ accessSecret: () => 'secret', fetch: async () => { started(); return new Promise<Response>(() => undefined); } });
  const result = source.search({ query: 'React', limit: 5, signal: controller.signal });
  await waiting;
  controller.abort();
  expect(await result).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
}, 1000);

it('preserves platform identity and actual text range when Tavily finds a platform URL', async () => {
  const source = createTavilySource({
    accessSecret: () => 'secret', fetch: async () => Response.json({
      results: [{
        title: '笔记',
        url: 'https://www.xiaohongshu.com/explore/abc123?xsec_token=secret',
        content: '🌏'.repeat(50_001)
      }]
    })
  });
  const result = await source.search({ query: '面试', limit: 5 });
  expect(result).toMatchObject({
    status: 'success', items: [{
      platform: 'xiaohongshu',
      externalId: 'abc123',
      url: 'https://www.xiaohongshu.com/explore/abc123',
      truncated: true,
      rangeEnd: 50_000
    }]
  });
});
