/* Verifies hidden-page responses, access parameters and note detail evidence. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createXiaohongshuSource } from '@megumi/application/recommendation/sources/xiaohongshu-source';
import type {
  EmbeddedBrowser,
  EmbeddedBrowserSnapshot,
} from '@megumi/application/recommendation/sources/browser-access';

function browser(snapshot: EmbeddedBrowserSnapshot): EmbeddedBrowser {
  return {
    async readPlatform() {
      return {
        status: 'success',
        snapshot,
      };
    },

    async snapshot() {
      return {
        status: 'success',
        snapshot,
      };
    },

    async fetchWithSession() {
      return new Response(null, { status: 503 });
    },

    async openLogin() {
      return { closed: Promise.resolve() };
    },

    async shutdown() {},
  };
}

describe('Xiaohongshu source', () => {
  it('recognizes note links on the search-result detail route without persisting access tokens', async () => {
    const source = createXiaohongshuSource({
      browser: browser({
        finalUrl: 'https://www.xiaohongshu.com/search_result?keyword=React',
        bodyText: '',
        links: [
          {
            href: 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=local-secret',
            text: 'React 教程',
            contextText: 'React 实践方法',
          },
        ],
      }),
    });

    expect(
      await source.search({
        query: 'React',
        limit: 3,
      }),
    ).toMatchObject({
      status: 'success',
      items: [
        {
          externalId: 'abc123',
          url: 'https://www.xiaohongshu.com/explore/abc123',
          title: 'React 教程',
          requestUrl: 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=local-secret',
        },
      ],
    });
  });
  it('reads the note body and its creation time with local access parameters', async () => {
    const source = createXiaohongshuSource({
      browser: browser({
        finalUrl: 'https://www.xiaohongshu.com/explore/abc123?xsec_token=local-secret',
        bodyText: '正文',
        links: [],
        structuredData: {
          note: {
            noteId: 'abc123',
            title: '面试',
            desc: '笔记的完整正文。',
            time: 1700000000000,
            lastUpdateTime: 1700100000000,
            user: {
              nickname: '甲',
              userId: 'u1',
            },
          },
        },
      }),
    });

    expect(
      await source.fetch({
        url: 'https://www.xiaohongshu.com/explore/abc123?xsec_token=local-secret',
      }),
    ).toMatchObject({
      status: 'success',
      material: {
        text: '笔记的完整正文。',
        kind: 'full_text',
        authorId: 'u1',
        publicationEvidence: [
          {
            kind: 'published',
            value: 1700000000000,
            status: 'verified',
          },
          {
            kind: 'modified',
            value: 1700100000000,
            status: 'unverified',
          },
        ],
      },
    });
  });
  it('uses captured search notes without rendered cards and keeps token out of identity', async () => {
    const source = createXiaohongshuSource({
      browser: browser({
        finalUrl: 'https://www.xiaohongshu.com/search_result?keyword=面试',
        bodyText: '',
        links: [],
        responses: [
          {
            url: 'https://www.xiaohongshu.com/api/sns/web/v2/search/notes',
            status: 200,
            body: JSON.stringify({
              success: true,
              code: 0,
              data: {
                items: [
                  {
                    id: 'abc123',
                    model_type: 'note',
                    xsec_token: 'local-secret',
                    note_card: {
                      display_title: '面试准备',
                      desc: '准备清单',
                      user: {
                        nickname: '甲',
                        user_id: 'author-1',
                      },
                    },
                  },
                ],
                has_more: false,
              },
            }),
          },
        ],
      }),
    });
    const result = await source.search({
      query: '面试',
      limit: 5,
    });

    expect(result).toMatchObject({
      status: 'success',
      items: [
        {
          externalId: 'abc123',
          url: 'https://www.xiaohongshu.com/explore/abc123',
          kind: 'excerpt',
          title: '面试准备',
          authorId: 'author-1',
        },
      ],
    });

    if (result.status !== 'success') throw new Error('Expected successful search');

    expect(new URL(result.items[0]!.requestUrl!).searchParams.get('xsec_token')).toBe(
      'local-secret',
    );
    expect(result.items[0]?.url).not.toContain('local-secret');
  });
});
