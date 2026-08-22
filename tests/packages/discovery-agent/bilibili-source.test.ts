/* Verifies Bilibili WBI signing, public search normalization and bounded failure handling. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createBilibiliSource,
  signBilibiliWbiParameters,
} from '@megumi/discovery-agent';

const navPayload = {
  code: 0,
  data: { wbi_img: {
    img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
    sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
  } },
};

describe('Bilibili discovery source', () => {
  it('generates a deterministic WBI signature from sorted and sanitized parameters', () => {
    const signed = signBilibiliWbiParameters({
      params: { keyword: "Agent!'()", search_type: 'video', page: 1 },
      imgKey: '7cd084941338484aae1ad9425b84077c',
      subKey: '4932caff0ff746eab6f01bf08b70ac45',
      timestampSeconds: 1_700_000_000,
    });

    expect(signed).toEqual({
      page: '1',
      keyword: 'Agent',
      search_type: 'video',
      wts: '1700000000',
      w_rid: 'eacedda9dfd7d2297a723483d06e44be',
    });
  });

  it('searches public videos without cookies and normalizes Bilibili fields', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(navPayload))
      .mockResolvedValueOnce(json({ code: 0, data: { result: [{
        bvid: 'BV1ABC123',
        title: '<em class="keyword">Agent</em> &amp; Harness',
        author: 'Alice',
        pubdate: 1_700_000_000,
        description: 'Implementation notes',
        pic: '//i0.hdslb.com/cover.jpg',
        play: 120,
        favorites: 8,
      }] } }));
    const source = createBilibiliSource({ fetch, now: () => 1_700_000_100_000 });

    const result = await source.search({
      query: 'Agent Harness', mode: 'recent', limit: 10, signal: new AbortController().signal,
    });

    const [, request] = fetch.mock.calls;
    const url = new URL(String(request[0]));
    expect(url.pathname).toBe('/x/web-interface/wbi/search/type');
    expect(url.searchParams.get('order')).toBe('pubdate');
    expect(url.searchParams.get('w_rid')).toMatch(/^[a-f0-9]{32}$/);
    expect(request[1]?.headers).not.toHaveProperty('cookie');
    expect(result).toEqual({ status: 'success', items: [{
      sourceId: 'bilibili',
      sourceName: '哔哩哔哩',
      sourceContentId: 'BV1ABC123',
      canonicalUrl: 'https://www.bilibili.com/video/BV1ABC123',
      contentType: 'video',
      title: 'Agent & Harness',
      author: 'Alice',
      publishedAt: '2023-11-14T22:13:20.000Z',
      description: 'Implementation notes',
      coverUrl: 'https://i0.hdslb.com/cover.jpg',
      engagement: { viewCount: 120, favoriteCount: 8 },
    }] });
  });

  it('uses anonymous nav WBI keys even when Bilibili reports code -101', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ...navPayload, code: -101, message: '账号未登录' }))
      .mockResolvedValueOnce(json({ code: 0, data: { result: [] } }));

    const result = await createBilibiliSource({ fetch }).search({
      query: '秋招面试经验', mode: 'relevance', limit: 20, signal: new AbortController().signal,
    });

    expect(result).toEqual({ status: 'success', items: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects an anonymous nav response only when WBI keys are actually missing', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      code: -101,
      message: '账号未登录',
      data: { wbi_img: {} },
    }));

    const result = await createBilibiliSource({ fetch }).search({
      query: 'Agent', mode: 'relevance', limit: 5, signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'invalid_response', message: 'Bilibili WBI keys were missing.' },
    });
  });

  it('caches WBI keys and refreshes them once after an invalid-key response', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(navPayload))
      .mockResolvedValueOnce(json({ code: 0, data: { result: [] } }))
      .mockResolvedValueOnce(json({ code: -403, message: 'invalid wbi signature' }))
      .mockResolvedValueOnce(json(navPayload))
      .mockResolvedValueOnce(json({ code: 0, data: { result: [] } }));
    const source = createBilibiliSource({ fetch, now: () => 1_700_000_100_000 });
    const request = { query: 'Agent', mode: 'relevance' as const, limit: 5, signal: new AbortController().signal };

    expect(await source.search(request)).toMatchObject({ status: 'success' });
    expect(await source.search(request)).toMatchObject({ status: 'success' });

    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/x/web-interface/nav',
      '/x/web-interface/wbi/search/type',
      '/x/web-interface/wbi/search/type',
      '/x/web-interface/nav',
      '/x/web-interface/wbi/search/type',
    ]);
  });

  it('distinguishes a successful empty result from network failure', async () => {
    const emptyFetch = vi.fn()
      .mockResolvedValueOnce(json(navPayload))
      .mockResolvedValueOnce(json({ code: 0, data: { result: [] } }));
    const failedFetch = vi.fn().mockRejectedValue(new Error('offline'));
    const request = { query: 'Agent', mode: 'relevance' as const, limit: 5, signal: new AbortController().signal };

    expect(await createBilibiliSource({ fetch: emptyFetch }).search(request))
      .toEqual({ status: 'success', items: [] });
    expect(await createBilibiliSource({ fetch: failedFetch }).search(request))
      .toMatchObject({ status: 'failed', failure: { code: 'network_error', retryable: true } });
  });

  it.each([
    { response: () => json({ code: 0 }, 429), code: 'rate_limited' },
    { response: () => json({ code: 0 }, 412), code: 'risk_control' },
    { response: () => json({ code: -352, data: { v_voucher: 'voucher' } }), code: 'risk_control' },
  ])('enters cooldown after $code responses', async ({ response, code }) => {
    let now = 1_700_000_000_000;
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(navPayload))
      .mockResolvedValueOnce(response());
    const source = createBilibiliSource({ fetch, now: () => now, cooldownMs: 60_000 });
    const request = { query: 'Agent', mode: 'relevance' as const, limit: 5, signal: new AbortController().signal };

    expect(await source.search(request)).toMatchObject({ status: 'failed', failure: { code } });
    const callsAfterFailure = fetch.mock.calls.length;
    expect(await source.search(request)).toMatchObject({ status: 'failed', failure: { code } });
    expect(fetch).toHaveBeenCalledTimes(callsAfterFailure);

    now += 60_001;
    fetch.mockResolvedValueOnce(json({ code: 0, data: { result: [] } }));
    expect(await source.search(request)).toMatchObject({ status: 'success' });
  });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
