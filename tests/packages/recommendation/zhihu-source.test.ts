/* Verifies browser-derived Zhihu material and access failures. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createZhihuSource } from '@megumi/application/recommendation/sources/zhihu-source';
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

describe('Zhihu browser material', () => {
  it('rejects a successful API envelope without a result list', async () => {
    const source = createZhihuSource({
      accessSecret: () => 'test-secret',
      fetch: async () => Response.json({ Code: 0 }),
    });

    expect(
      await source.search({
        query: '面试',
        limit: 5,
      }),
    ).toMatchObject({
      status: 'failed',
      failure: { code: 'invalid_response' },
    });
  });
  it('uses the requested page body when structured answer data is absent', async () => {
    const source = createZhihuSource({
      accessSecret: () => undefined,
      browser: browser({
        finalUrl: 'https://www.zhihu.com/question/10/answer/20',
        bodyText: '目标回答正文',
        truncated: true,
        links: [],
      }),
    });

    expect(
      await source.fetch({ url: 'https://www.zhihu.com/question/10/answer/20' }),
    ).toMatchObject({
      status: 'success',
      material: {
        text: '目标回答正文',
        kind: 'full_text',
        truncated: true,
        publicationEvidence: [],
      },
    });
  });
  it('searches the isolated page when an API credential is absent', async () => {
    const source = createZhihuSource({
      accessSecret: () => undefined,
      browser: browser({
        finalUrl: 'https://www.zhihu.com/search?q=面试&type=content',
        bodyText: '',
        links: [
          {
            href: 'https://www.zhihu.com/question/10/answer/20',
            text: '面试经验',
            contextText: '如何准备技术面试。',
          },
        ],
      }),
    });

    expect(
      await source.search({
        query: '面试',
        limit: 5,
      }),
    ).toMatchObject({
      status: 'success',
      items: [
        {
          platform: 'zhihu',
          externalId: '20',
          title: '面试经验',
          text: '如何准备技术面试。',
          kind: 'excerpt',
          method: 'zhihu_browser_search',
        },
      ],
    });
  });
  it('reads only the requested answer and keeps creation separate from modification', async () => {
    const source = createZhihuSource({
      accessSecret: () => undefined,
      browser: browser({
        finalUrl: 'https://www.zhihu.com/question/10/answer/20',
        bodyText: '正文',
        links: [],
        structuredData: {
          answers: {
            '20': {
              id: 20,
              content: '<p>所请求的完整正文</p>',
              createdTime: 1700000000,
              updatedTime: 1700100000,
              author: {
                name: '甲',
                id: 'author-1',
              },
            },
            '21': {
              id: 21,
              content: '<p>不应返回的答案</p>',
              createdTime: 1800000000,
            },
          },
          articles: {},
        },
      }),
    });
    const result = await source.fetch({ url: 'https://www.zhihu.com/question/10/answer/20' });

    expect(result).toMatchObject({
      status: 'success',
      material: {
        text: '所请求的完整正文',
        kind: 'full_text',
        author: '甲',
        authorId: 'author-1',
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
});
