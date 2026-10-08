/* Verifies source composition uses independent search and material fallback paths. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { createSourceAccess } from '@megumi/application/recommendation/sources/source-access';
import type { EmbeddedBrowser } from '@megumi/application/recommendation/sources/browser-access';

it('falls through a successful empty Tavily search to Bing once', async () => {
  const requests: string[] = [];
  const access = createSourceAccess({
    enabledSources: () => ['tavily', 'bing_rss', 'bilibili'],
    accessSecret: () => 'secret',

    fetch: async input => {
      const url = new URL(String(input));
      requests.push(url.hostname);
      if (url.hostname === 'api.tavily.com') return Response.json({ results: [] });

      return new Response(
        '<rss><channel><item><title>面试</title><link>https://www.bilibili.com/video/BV17x411w7KC</link><description>准备技术面试。</description></item></channel></rss>',
      );
    },
  });
  const result = await access
    .connectors()
    .find(source => source.id === 'tavily')!
    .search({
      query: '面试',
      limit: 5,
    });

  expect(result).toMatchObject({
    status: 'success',
    items: [
      {
        source: 'bing_rss',
        platform: 'bilibili',
        externalId: 'BV17x411w7KC',
      },
    ],
  });
  expect(requests).toEqual(['api.tavily.com', 'www.bing.com']);
});

it('excludes a disabled platform found by general search', async () => {
  const access = createSourceAccess({
    enabledSources: () => ['tavily'],
    accessSecret: () => 'secret',

    fetch: async () =>
      Response.json({
        results: [
          {
            title: '视频',
            url: 'https://www.bilibili.com/video/BV17x411w7KC',
            content: '简介',
          },
          {
            title: '文章',
            url: 'https://example.com/article',
            content: '正文',
          },
        ],
      }),
  });

  expect(
    await access.connectors()[0]!.search({
      query: '面试',
      limit: 5,
    }),
  ).toMatchObject({
    status: 'success',
    items: [
      {
        platform: 'web',
        url: 'https://example.com/article',
      },
    ],
  });
});

it('uses protected direct fetch after per-URL extraction fails', async () => {
  const requests: string[] = [];
  const access = createSourceAccess({
    enabledSources: () => ['tavily'],
    accessSecret: () => 'secret',

    fetch: async () => {
      requests.push('extract');
      return Response.json({
        results: [],
        failed_results: [
          {
            url: 'https://example.com/article',
            error: 'Unavailable',
          },
        ],
      });
    },

    webFetch: {
      async fetch(request) {
        requests.push(request.url);
        return {
          url: request.url,
          title: '正文',
          contentType: 'text/html',
          content: '网页原文',
          document: '<article>网页原文</article>',
          truncated: false,
        };
      },
    },
  });
  const result = await access.acquireMaterial({
    source: 'bing_rss',
    platform: 'web',
    url: 'https://example.com/article',
    text: '摘要',
  });

  expect(result).toMatchObject({
    status: 'success',
    material: {
      text: '网页原文',
      method: 'direct_web',
      kind: 'full_text',
    },
  });
  expect(requests).toEqual(['extract', 'https://example.com/article']);
});

it('uses a site query after platform search fails and retains the acquiring service', async () => {
  let query = '';
  const access = createSourceAccess({
    enabledSources: () => ['zhihu', 'bing_rss'],
    accessSecret: () => undefined,

    fetch: async input => {
      query = new URL(String(input)).searchParams.get('q') ?? '';
      return new Response(
        '<rss><channel><item><title>文章</title><link>https://zhuanlan.zhihu.com/p/123</link><description>面试准备。</description></item></channel></rss>',
      );
    },
  });

  expect(
    await access
      .connectors()
      .find(source => source.id === 'zhihu')!
      .search({
        query: '面试',
        limit: 5,
      }),
  ).toMatchObject({
    status: 'success',
    items: [
      {
        platform: 'zhihu',
        source: 'bing_rss',
        externalId: '123',
      },
    ],
  });
  expect(query).toBe('site:zhihu.com 面试');
});

it('reads configuration locally and probes only the explicitly checked source', async () => {
  const requests: string[] = [];
  const access = createSourceAccess({
    enabledSources: () => ['tavily', 'bing_rss'],
    accessSecret: () => undefined,
    now: () => 1700000000000,

    fetch: async input => {
      requests.push(new URL(String(input)).hostname);
      return new Response('<rss><channel></channel></rss>');
    },
  });

  expect(access.readStatuses()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'tavily',
        state: 'not_configured',
      }),
      expect.objectContaining({
        sourceId: 'bing_rss',
        state: 'unchecked',
      }),
      expect.objectContaining({
        sourceId: 'zhihu',
        state: 'disabled',
      }),
    ]),
  );
  expect(requests).toEqual([]);
  expect(await access.checkSourceAccess('bing_rss')).toMatchObject({
    state: 'available',
    checkedAt: '2023-11-14T22:13:20.000Z',
  });
  expect(requests).toEqual(['www.bing.com']);
});

it('checks the configured Zhihu API without requiring browser login', async () => {
  const access = createSourceAccess({
    enabledSources: () => ['zhihu'],
    accessSecret: () => 'test-secret',

    fetch: async () =>
      Response.json({
        Code: 0,
        Data: { Items: [] },
      }),
  });

  expect(await access.checkSourceAccess('zhihu')).toMatchObject({ state: 'available' });
});

it('can recheck Tavily after a missing credential is supplied', async () => {
  let secret: string | undefined;
  const access = createSourceAccess({
    enabledSources: () => ['tavily'],
    accessSecret: () => secret,
    fetch: async () => Response.json({ results: [] }),
  });
  await access.connectors()[0]!.search({
    query: '面试',
    limit: 1,
  });
  secret = 'test-secret';

  expect(await access.checkSourceAccess('tavily')).toMatchObject({ state: 'available' });
});

it('uses shared request budget for the fallback and preserves disabled sources', async () => {
  let enabled = ['tavily', 'bing_rss'];
  const hosts: string[] = [];
  const access = createSourceAccess({
    enabledSources: () => enabled,
    accessSecret: () => 'secret',

    fetch: async input => {
      hosts.push(new URL(String(input)).hostname);
      return new Response(null, { status: 401 });
    },
  });
  const source = access.connectors().find(entry => entry.id === 'tavily')!;
  let budget = 1;

  expect(
    await source.search({
      query: '面试',
      limit: 5,
      reserveRequest: () => budget-- > 0,
    }),
  ).toMatchObject({
    status: 'failed',
    failure: { code: 'budget_exhausted' },
  });
  expect(hosts).toEqual(['api.tavily.com']);

  enabled = [];

  expect(access.connectors()).toEqual([]);
  expect(
    await source.search({
      query: '面试',
      limit: 5,
    }),
  ).toMatchObject({
    status: 'failed',
    failure: { code: 'not_configured' },
  });
  expect(hosts).toEqual(['api.tavily.com']);
});

it('keeps a throttled source cooling while healthy Bing serves later requests', async () => {
  const hosts: string[] = [];
  const access = createSourceAccess({
    enabledSources: () => ['tavily', 'bing_rss'],
    accessSecret: () => 'secret',
    now: () => 1700000000000,

    fetch: async input => {
      const host = new URL(String(input)).hostname;
      hosts.push(host);
      return host === 'api.tavily.com'
        ? new Response(null, {
            status: 429,
            headers: { 'Retry-After': '17' },
          })
        : new Response('<rss><channel></channel></rss>');
    },
  });
  const source = access.connectors().find(entry => entry.id === 'tavily')!;
  await source.search({
    query: '面试',
    limit: 5,
  });
  await source.search({
    query: '求职',
    limit: 5,
  });

  expect(hosts).toEqual(['api.tavily.com', 'www.bing.com', 'www.bing.com']);
  expect(access.readStatuses()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'tavily',
        state: 'cooling_down',
        retryAt: '2023-11-14T22:13:37.000Z',
      }),
    ]),
  );
});

it('uses platform detail before web extraction and preserves the local note access URL', async () => {
  let requested = '';
  const browser: EmbeddedBrowser = {
    async readPlatform(request) {
      requested = request.url;
      return {
        status: 'success',
        snapshot: {
          finalUrl: request.url,
          bodyText: '',
          links: [],
          structuredData: {
            note: {
              noteId: 'abc123',
              desc: '笔记正文',
              time: 1700000000000,
            },
          },
        },
      };
    },

    async snapshot() {
      return {
        status: 'failed',
        failure: {
          code: 'invalid_response',
          message: 'Unused',
        },
      };
    },

    async fetchWithSession() {
      throw new Error('Unexpected request');
    },

    async openLogin() {
      return { closed: Promise.resolve() };
    },

    async shutdown() {},
  };
  const access = createSourceAccess({
    enabledSources: () => ['xiaohongshu', 'tavily'],
    accessSecret: () => 'secret',
    browser,

    fetch: async () => {
      throw new Error('Unexpected web extraction');
    },

    webFetch: {
      async fetch() {
        throw new Error('Unexpected direct access');
      },
    },
  });

  expect(
    await access.acquireMaterial({
      source: 'bing_rss',
      platform: 'xiaohongshu',
      externalId: 'abc123',
      url: 'https://www.xiaohongshu.com/explore/abc123',
      requestUrl: 'https://www.xiaohongshu.com/explore/abc123?xsec_token=local-secret',
    }),
  ).toMatchObject({
    status: 'success',
    material: {
      method: 'xiaohongshu_note_state',
      text: '笔记正文',
    },
  });
  expect(new URL(requested).searchParams.get('xsec_token')).toBe('local-secret');
});

it('reports only an opened login window, then verifies access after the window closes', async () => {
  let close: () => void = () => undefined;
  const closed = new Promise<void>(resolve => {
    close = resolve;
  });
  let checked: () => void = () => undefined;
  const probe = new Promise<void>(resolve => {
    checked = resolve;
  });
  const browser: EmbeddedBrowser = {
    async openLogin() {
      return { closed };
    },

    async readPlatform() {
      checked();
      return {
        status: 'success',
        snapshot: {
          finalUrl: 'https://www.xiaohongshu.com/',
          bodyText: '',
          links: [],
          pageState: 'login_required',
        },
      };
    },

    async snapshot() {
      return {
        status: 'failed',
        failure: {
          code: 'invalid_response',
          message: 'Unused',
        },
      };
    },

    async fetchWithSession() {
      throw new Error('Unexpected request');
    },

    async shutdown() {},
  };
  const access = createSourceAccess({
    enabledSources: () => ['xiaohongshu'],
    accessSecret: () => undefined,
    browser,
  });

  expect(await access.openSourceLogin('xiaohongshu')).toEqual({ status: 'opened' });
  expect(access.readStatuses().find(entry => entry.sourceId === 'xiaohongshu')?.state).toBe(
    'unchecked',
  );

  close();
  await probe;
  await Promise.resolve();

  expect(access.readStatuses().find(entry => entry.sourceId === 'xiaohongshu')?.state).toBe(
    'login_required',
  );
});
