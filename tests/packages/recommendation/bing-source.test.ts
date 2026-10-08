/* Verifies acquired service and platform identity remain distinct in Bing results. */
// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createBingSource } from '@megumi/application/recommendation/sources/bing-source';

it('identifies a platform discovery independently of Bing and preserves its unverified date', async () => {
  const source = createBingSource({
    fetch: async () =>
      new Response(
        '<rss><channel><item><title>视频</title><link>https://www.bilibili.com/video/BV1test?share_source=copy</link><description>面试准备</description><pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>',
      ),
  });

  expect(
    await source.search({
      query: '面试',
      limit: 3,
    }),
  ).toMatchObject({
    status: 'success',
    items: [
      {
        source: 'bing_rss',
        platform: 'bilibili',
        externalId: 'BV1test',
        url: 'https://www.bilibili.com/video/BV1test',
        text: '面试准备',
        kind: 'excerpt',
        publicationEvidence: [
          {
            status: 'unverified',
            location: 'RSS.pubDate',
          },
        ],
      },
    ],
  });
});

it('cancels while an RSS body is still loading instead of waiting for its completion', async () => {
  const controller = new AbortController();
  let began: () => void = () => undefined;
  const loading = new Promise<void>(resolve => {
    began = resolve;
  });
  const source = createBingSource({
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull() {
            began();
            return new Promise<void>(() => undefined);
          },
        }),
      ),
  });
  const pending = source.search({
    query: '面试',
    limit: 3,
    signal: controller.signal,
  });
  await loading;
  controller.abort();

  expect(await pending).toMatchObject({
    status: 'failed',
    failure: { code: 'cancelled' },
  });
}, 1000);

it('retries a transient RSS failure and charges the next physical request', async () => {
  vi.useFakeTimers();

  try {
    let attempts = 0;
    let reservations = 0;
    const source = createBingSource({
      fetch: async () =>
        ++attempts === 1
          ? new Response(null, { status: 503 })
          : new Response('<rss><channel></channel></rss>'),
    });
    const pending = source.search({
      query: '面试',
      limit: 3,
      reserveRequest: () => ++reservations <= 2,
    });
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({
      status: 'success',
      items: [],
    });
    expect(attempts).toBe(2);
    expect(reservations).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});
