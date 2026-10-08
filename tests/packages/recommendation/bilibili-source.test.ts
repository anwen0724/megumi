/* Verifies Bilibili protocol and acquired material rather than video watchability. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createBilibiliSource } from '@megumi/application/recommendation/sources/bilibili-source';
import type { EmbeddedBrowser } from '@megumi/application/recommendation/sources/browser-access';

function json(value: unknown) {
  return new Response(JSON.stringify(value));
}

describe('Bilibili source', () => {
  it('uses one signed detail request when the API requires signing and preserves descriptions without subtitles', async () => {
    const paths: string[] = [];
    const source = createBilibiliSource({
      fetch: async input => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        if (url.pathname === '/x/web-interface/view') return json({ code: -400 });
        if (url.pathname.endsWith('/nav'))
          return json({
            code: 0,
            data: {
              wbi_img: {
                img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
              },
            },
          });
        if (url.pathname === '/x/web-interface/wbi/view')
          return json({
            code: 0,
            data: {
              bvid: 'BV17x411w7KC',
              title: '面试',
              desc: '视频简介',
              pubdate: 1700000000,
              aid: 123,
              cid: 456,
              owner: {
                name: 'UP',
                mid: 99,
              },
            },
          });

        return json({
          code: 0,
          data: { subtitle: { subtitles: [] } },
        });
      },
    });

    expect(
      await source.fetch({ url: 'https://www.bilibili.com/video/BV17x411w7KC' }),
    ).toMatchObject({
      status: 'success',
      material: {
        text: '视频简介',
        kind: 'description',
      },
    });
    expect(paths).toEqual([
      '/x/web-interface/view',
      '/x/web-interface/nav',
      '/x/web-interface/wbi/view',
      '/x/player/v2',
    ]);
  });
  it('reserves every physical request and stops before an unbudgeted search', async () => {
    let calls = 0;
    const charged: string[] = [];
    const source = createBilibiliSource({
      fetch: async () => {
        calls++;
        return json({
          code: 0,
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
            },
          },
        });
      },
    });
    const result = await source.search({
      query: '面试',
      limit: 5,

      reserveRequest(kind) {
        charged.push(kind);
        return kind === 'material';
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'budget_exhausted' },
    });
    expect(charged).toEqual(['material', 'search']);
    expect(calls).toBe(1);
  });
  it('keeps a page description when the API is challenged and makes no further API request', async () => {
    let apiCalls = 0;
    const browser: EmbeddedBrowser = {
      async fetchWithSession() {
        apiCalls++;
        return new Response(null, { status: 412 });
      },

      async readPlatform() {
        return {
          status: 'success',
          snapshot: {
            finalUrl: 'https://www.bilibili.com/video/BV17x411w7KC',
            bodyText: '作者的视频简介。',
            links: [],
            structuredData: {
              video: {
                bvid: 'BV17x411w7KC',
                title: '标题',
                desc: '作者的视频简介。',
                pubdate: 1700000000,
                owner: {
                  name: 'UP',
                  mid: 1,
                },
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

      async openLogin() {
        return { closed: Promise.resolve() };
      },

      async shutdown() {},
    };
    const source = createBilibiliSource({ browser });
    const result = await source.fetch({ url: 'https://www.bilibili.com/video/BV17x411w7KC' });

    expect(result).toMatchObject({
      status: 'success',
      material: {
        kind: 'description',
        text: '作者的视频简介。',
        method: 'bilibili_browser_detail',
      },
    });
    expect(
      await source.fetch({ url: 'https://www.bilibili.com/video/BV17x411w7KC' }),
    ).toMatchObject({
      status: 'success',
      material: { kind: 'description' },
    });
    expect(apiCalls).toBe(1);
  });
  it('returns acquired subtitles as a transcript, not as a description', async () => {
    const source = createBilibiliSource({
      fetch: async input => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/view'))
          return json({
            code: 0,
            data: {
              bvid: 'BV17x411w7KC',
              title: '面试',
              desc: '这是简介',
              pubdate: 1700000000,
              aid: 123,
              cid: 456,
              owner: {
                name: 'UP',
                mid: 99,
              },
            },
          });
        if (url.pathname.endsWith('/v2'))
          return json({
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    lan: 'zh-CN',
                    subtitle_url: '//i0.hdslb.com/bfs/subtitle/test.json',
                  },
                ],
              },
            },
          });

        return json({
          body: [
            {
              from: 0,
              to: 1,
              content: '第一段字幕。',
            },
            {
              from: 1,
              to: 2,
              content: '第二段字幕。',
            },
          ],
        });
      },
    });

    expect(
      await source.fetch({ url: 'https://www.bilibili.com/video/BV17x411w7KC' }),
    ).toMatchObject({
      status: 'success',
      material: {
        text: '第一段字幕。\n第二段字幕。',
        kind: 'transcript',
        method: 'bilibili_subtitle',
        authorId: '99',
        publicationEvidence: [
          {
            kind: 'published',
            value: 1700000000000,
            status: 'verified',
          },
        ],
      },
    });
  });
  it('signs video search and returns description with verified publication evidence', async () => {
    let searchUrl: URL | undefined;
    const source = createBilibiliSource({
      now: () => 1702204169000,

      fetch: async input => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/nav'))
          return json({
            code: 0,
            data: {
              wbi_img: {
                img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
              },
            },
          });

        searchUrl = url;

        return json({
          code: 0,
          data: {
            result: [
              {
                bvid: 'BV17x411w7KC',
                title: '<em>测试</em>视频',
                description: '视频简介。',
                author: 'UP',
                mid: 123,
                pubdate: 1700000000,
              },
            ],
          },
        });
      },
    });
    const result = await source.search({
      query: '面试',
      limit: 5,
      timeRange: {
        from: 1699900000000,
        to: 1700100000000,
      },
    });

    expect(result).toMatchObject({
      status: 'success',
      items: [
        {
          platform: 'bilibili',
          externalId: 'BV17x411w7KC',
          title: '测试视频',
          text: '视频简介。',
          kind: 'description',
          publicationEvidence: [
            {
              kind: 'published',
              value: 1700000000000,
              status: 'verified',
            },
          ],
        },
      ],
    });
    expect(searchUrl?.pathname).toBe('/x/web-interface/wbi/search/type');
    expect(searchUrl?.searchParams.get('search_type')).toBe('video');
    expect(searchUrl?.searchParams.get('order')).toBe('pubdate');
    expect(searchUrl?.searchParams.get('pubtime_begin')).toBe('1699900000');
    expect(searchUrl?.searchParams.get('w_rid')).toMatch(/^[a-f0-9]{32}$/);
  });
});
