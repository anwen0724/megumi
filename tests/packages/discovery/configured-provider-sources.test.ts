/* Verifies configured provider sources normalize public content without leaking credentials. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createTwitterSource, createZhihuSource } from '@megumi/discovery';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';

describe('configured provider discovery sources', () => {
  it('uses the official Zhihu search API and clamps its one-call result limit to ten', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      // Shape captured from the real provider; content and identity are sanitized.
      Code: 0, Message: 'success', Data: { HasMore: false, Items: [{
        Title: 'RAG 评测方法综述',
        Url: 'https://www.zhihu.com/question/1/answer/2',
        ContentType: 'Answer',
        ContentText: '一份完整的评测方法说明。',
        AuthorName: '张三',
        EditTime: '2026-08-23T12:30:00+08:00',
      }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const source = createZhihuSource({
      accessSecret: () => 'zhihu-secret',
      fetch: fetch as typeof globalThis.fetch,
      now: () => 1_777_000_000_000,
    });
    const providerResponses: unknown[] = [];

    const result = await source.search({
      query: 'RAG', mode: 'relevance', limit: 20, signal: new AbortController().signal,
      onProviderResponse: (response) => {
        providerResponses.push(response);
        throw new Error('diagnostics unavailable');
      },
    });

    expect(source.descriptor).toMatchObject({
      id: 'zhihu', access: 'configured_provider', supportedModes: ['relevance'], supportsRead: false,
    });
    const [requestUrl, requestInit] = fetch.mock.calls[0]!;
    expect(new URL(String(requestUrl)).searchParams.get('Query')).toBe('RAG');
    expect(new URL(String(requestUrl)).searchParams.get('Count')).toBe('10');
    expect(requestInit?.headers).toMatchObject({
      Authorization: 'Bearer zhihu-secret',
      'X-Request-Timestamp': '1777000000',
    });
    expect(result).toEqual({
      status: 'success',
      items: [expect.objectContaining({
        sourceId: 'zhihu', sourceContentId: 'answer:2', contentType: 'article',
        title: 'RAG 评测方法综述', author: '张三', description: '一份完整的评测方法说明。',
      })],
    });
    expect(JSON.stringify(result)).not.toContain('zhihu-secret');
    expect(providerResponses).toEqual([expect.stringContaining('RAG 评测方法综述')]);
  });

  it('reports Zhihu as not configured without invoking the provider', async () => {
    const fetch = vi.fn();
    const source = createZhihuSource({ accessSecret: () => undefined, fetch });
    expect(source.getAvailability()).toEqual({ state: 'not_configured' });
    await expect(source.search({
      query: 'Agent', mode: 'relevance', limit: 5, signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'failed', failure: { code: 'not_configured' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { Code: 0, Data: {} },
    { Code: 123, Message: 'provider rejected request', Data: { Items: [] } },
    { unexpected: [] },
    '<html>upstream error</html>',
    { Code: 0, Data: { Items: [{ Title: 'Missing URL' }] } },
  ])('does not report malformed Zhihu evidence as an empty successful search: %j', async (payload) => {
    const source = createZhihuSource({
      accessSecret: () => 'key',
      fetch: async () => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload)),
    });
    await expect(source.search({ query: 'test', mode: 'relevance', limit: 10, signal: new AbortController().signal }))
      .resolves.toMatchObject({ status: 'failed', failure: { code: 'invalid_response', retryable: false } });
  });

  it('accepts an explicit empty Zhihu Items array', async () => {
    const source = createZhihuSource({
      accessSecret: () => 'key',
      fetch: async () => new Response(JSON.stringify({ Code: 0, Data: { Items: [] } })),
    });
    await expect(source.search({ query: 'test', mode: 'relevance', limit: 10, signal: new AbortController().signal }))
      .resolves.toEqual({ status: 'success', items: [] });
  });

  it('retains the raw HTTP error response while reporting rate limiting', async () => {
    const responses: unknown[] = [];
    const source = createZhihuSource({ accessSecret: () => 'key', fetch: async () => new Response('rate limit response', { status: 429 }) });
    await expect(source.search({
      query: 'test', mode: 'relevance', limit: 10, signal: new AbortController().signal,
      onProviderResponse: response => { responses.push(response); throw new Error('diagnostics unavailable'); },
    })).resolves.toMatchObject({ status: 'failed', failure: { code: 'rate_limited', retryable: true } });
    expect(responses).toEqual(['rate limit response']);
    expect(source.getAvailability()).toMatchObject({ state: 'rate_limited' });
  });

  it.each([1788490000, '2026-09-04T05:26:40.000Z'])('preserves valid Zhihu entries without treating edit time %s as publication time', async (editTime) => {
    const records: TraceJournalRecord[] = [];
    const observability = createTraceRecorder({ enqueue: record => { records.push(record); } });
    const source = createZhihuSource({ accessSecret: () => 'key', observability, fetch: async () => new Response(JSON.stringify({
      Code: 0, Data: { Items: [
        { Title: 'Valid article', Url: 'https://zhuanlan.zhihu.com/p/123', ContentText: 'Body', EditTime: editTime },
        { Title: 'No URL' },
        { Title: 'Invalid URL', Url: 'not a url' },
      ] },
    })) });
    const result = await observability.withTrace({ kind: 'candidate_supply' }, () => source.search({
      query: 'test', mode: 'relevance', limit: 10, signal: new AbortController().signal,
    }));
    expect(result).toMatchObject({ status: 'success', items: [{ title: 'Valid article' }] });
    if (result.status === 'success') expect(result.items[0]?.publishedAt).toBeUndefined();
    expect(records).toContainEqual(expect.objectContaining({ kind: 'source.normalization', content: expect.objectContaining({
      value: { inputCount: 3, acceptedCount: 1, rejected: [
        { index: 1, reason: 'missing_url_or_title' }, { index: 2, reason: 'invalid_content_fields' },
      ] },
    }) }));
  });

  it.each([
    ['relevance', 'Top'],
    ['recent', 'Latest'],
  ] as const)('maps Twitter %s to %s and converts tweets deterministically', async (mode, queryType) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      tweets: [{
        id: '19001',
        url: 'https://x.com/example/status/19001',
        text: 'Agent harness 的边界怎么划分？\n这里是完整正文。',
        createdAt: 'Sat Aug 22 10:00:00 +0000 2026',
        likeCount: 12,
        replyCount: 3,
        retweetCount: 4,
        bookmarkCount: 5,
        viewCount: 100,
        author: { name: 'Example', userName: 'example' },
      }],
      has_next_page: false,
      next_cursor: '',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const source = createTwitterSource({ apiKey: () => 'twitter-secret', fetch: fetch as typeof globalThis.fetch });
    const providerResponses: unknown[] = [];

    const result = await source.search({
      query: 'Agent harness', mode, limit: 5, signal: new AbortController().signal,
      onProviderResponse: (response) => {
        providerResponses.push(response);
        throw new Error('diagnostics unavailable');
      },
    });

    const [requestUrl, requestInit] = fetch.mock.calls[0]!;
    expect(new URL(String(requestUrl)).searchParams.get('queryType')).toBe(queryType);
    expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'twitter-secret' });
    expect(result).toEqual({
      status: 'success',
      items: [expect.objectContaining({
        sourceId: 'twitter', sourceContentId: '19001', contentType: 'post',
        title: 'Agent harness 的边界怎么划分？',
        description: 'Agent harness 的边界怎么划分？\n这里是完整正文。',
        author: 'Example (@example)',
        engagement: { viewCount: 100, likeCount: 12, commentCount: 3, favoriteCount: 5 },
      })],
    });
    expect(JSON.stringify(result)).not.toContain('twitter-secret');
    expect(providerResponses).toEqual([expect.objectContaining({ tweets: expect.any(Array) })]);
  });

  it('uses cursors only until the requested result limit is satisfied', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response([tweet('1'), tweet('2')], true, 'cursor:2'))
      .mockResolvedValueOnce(response([tweet('3'), tweet('4')], false, ''));
    const source = createTwitterSource({ apiKey: () => 'key', fetch: fetch as typeof globalThis.fetch });
    const result = await source.search({
      query: 'Agent', mode: 'recent', limit: 3, signal: new AbortController().signal,
    });
    expect(result.status === 'success' ? result.items.map((item) => item.sourceContentId) : []).toEqual(['1', '2', '3']);
    expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get('cursor')).toBe('cursor:2');
  });
});

function tweet(id: string) {
  return { id, url: `https://x.com/example/status/${id}`, text: `Tweet ${id}`, author: { userName: 'example' } };
}

function response(tweets: unknown[], hasNextPage: boolean, nextCursor: string) {
  return new Response(JSON.stringify({ tweets, has_next_page: hasNextPage, next_cursor: nextCursor }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}
