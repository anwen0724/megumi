/* Verifies source mapping and content normalization keep one shared shape. */
// @vitest-environment node
import { createZhihuSource } from '@megumi/application/recommendation/sources/zhihu-source';
import {
  detectContentLanguage,
  htmlToPlainText,
  normalizeContentUrl,
  normalizeRawItem,
} from '@megumi/application/recommendation/content/normalize-content';
import { describe, expect, it } from 'vitest';

describe('content normalization', () => {
  it('drops the fragment and tracking parameters but keeps content parameters', () => {
    const normalized = normalizeContentUrl(
      'https://Zhuanlan.Zhihu.com:443/p/123?utm_medium=openapi_platform&utm_source=abc&page=2#section',
    );

    expect(normalized).toBe('https://zhuanlan.zhihu.com/p/123?page=2');
  });

  it('keeps paragraph and list structure when converting HTML', () => {
    const text = htmlToPlainText('<p>第一段</p><ul><li>甲</li><li>乙</li></ul><p>第二段</p>');

    expect(text).toBe('第一段\n\n- 甲\n- 乙\n\n第二段');
  });

  it('keeps code block content on its own lines', () => {
    const text = htmlToPlainText('<p>示例</p><pre>const a = 1;\n  return a;</pre>');

    expect(text).toBe('示例\n\nconst a = 1;\n  return a;');
  });

  it('rejects a discovery without usable text instead of analyzing a title only', () => {
    const result = normalizeRawItem({
      source: 'zhihu',
      url: 'https://zhuanlan.zhihu.com/p/1',
      title: '只有标题',
    });

    expect(result.status).toBe('rejected');

    if (result.status !== 'rejected') throw new Error('expected a rejection');

    expect(result.reason).toBe('no_text');
  });

  it('keeps a whitespace-only body as missing text rather than as a link list', () => {
    const result = normalizeRawItem({
      source: 'zhihu',
      url: 'https://zhuanlan.zhihu.com/p/2',
      text: '  \n\t ',
    });

    expect(result.status).toBe('rejected');

    if (result.status !== 'rejected') throw new Error('expected a rejection');

    expect(result.reason).toBe('no_text');
  });

  it('rejects a body whose text is only links', () => {
    const result = normalizeRawItem({
      source: 'zhihu',
      url: 'https://zhuanlan.zhihu.com/p/3',
      title: '限时优惠',
      text: 'https://shop.example.com/item/1\nhttps://shop.example.com/item/2',
    });

    expect(result.status).toBe('rejected');

    if (result.status !== 'rejected') throw new Error('expected a rejection');

    expect(result.reason).toBe('link_only');
  });

  it('rejects a body that is links plus a purchase call to action', () => {
    const result = normalizeRawItem({
      source: 'zhihu',
      url: 'https://zhuanlan.zhihu.com/p/4',
      text: 'https://shop.example.com/item/1 点击购买\nhttps://shop.example.com/item/2 立即下单',
    });

    expect(result.status).toBe('rejected');

    if (result.status !== 'rejected') throw new Error('expected a rejection');

    expect(result.reason).toBe('link_only');
  });

  it('keeps a short material that still states one fact', () => {
    const result = normalizeRawItem({
      source: 'zhihu',
      url: 'https://zhuanlan.zhihu.com/p/5',
      text: '该版本把超时改成 30 秒。',
    });

    expect(result.status).toBe('ok');

    if (result.status !== 'ok') throw new Error('expected normalized content');

    expect(result.content.text).toBe('该版本把超时改成 30 秒。');
  });

  it('keeps a short body whose links are not the whole content', () => {
    const result = normalizeRawItem({
      source: 'zhihu',
      url: 'https://zhuanlan.zhihu.com/p/6',
      text: '发布说明见 https://example.com/notes，该版本把超时改成 30 秒。',
    });

    expect(result.status).toBe('ok');

    if (result.status !== 'ok') throw new Error('expected normalized content');

    expect(result.content.text).toBe(
      '发布说明见 https://example.com/notes，该版本把超时改成 30 秒。',
    );
  });

  it('rejects content whose detected language is outside the configured set', () => {
    const result = normalizeRawItem(
      {
        source: 'zhihu',
        url: 'https://example.com/a',
        text: '这是一段足够长的中文内容，用于判断语言归属并触发配置检查。',
      },
      { contentLanguages: ['en'] },
    );

    expect(result.status).toBe('rejected');

    if (result.status !== 'rejected') throw new Error('expected a rejection');

    expect(result.reason).toBe('language');
  });

  it('leaves language unknown for a sample too small to judge', () => {
    expect(detectContentLanguage('短')).toBeUndefined();
  });
});

describe('zhihu source', () => {
  it('keeps EditTime as modification evidence and uses the page identity', async () => {
    const source = createZhihuSource({
      accessSecret: () => 'secret',

      // The platform sends ContentID as a raw int64 number. A JavaScript object
      // literal would already round it, so the body stays a string here.
      fetch: async () =>
        new Response(
          '{"Code":0,"Message":"success","Data":{"HasMore":false,"SearchHashId":"hash","Items":[' +
            '{"Title":"标题","ContentType":"Article","ContentID":-5776787301334619690,' +
            '"ContentText":"正文片段","Url":"https://zhuanlan.zhihu.com/p/1?utm_medium=openapi_platform",' +
            '"AuthorName":"作者","EditTime":1791161176}]}}',
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    });

    const result = await source.search({
      query: '摄影',
      limit: 5,
    });

    expect(result.status).toBe('success');

    if (result.status !== 'success') throw new Error('expected a successful search');

    expect(result.items).toMatchObject([
      {
        source: 'zhihu',
        platform: 'zhihu',
        url: 'https://zhuanlan.zhihu.com/p/1',
        title: '标题',
        text: '正文片段',
        author: '作者',
        externalId: '1',
        kind: 'excerpt',
        publicationEvidence: [
          {
            kind: 'modified',
            value: 1791161176000,
            status: 'unverified',
          },
        ],
      },
    ]);
    expect(result.items[0]?.publishedAt).toBeUndefined();
  });

  it('reports a missing credential without calling the platform', async () => {
    let called = false;
    const source = createZhihuSource({
      accessSecret: () => undefined,

      fetch: async () => {
        called = true;
        return jsonResponse({ Code: 0 });
      },
    });

    const result = await source.search({
      query: '摄影',
      limit: 5,
    });

    expect(result.status).toBe('failed');

    if (result.status !== 'failed') throw new Error('expected a failure');

    expect(result.failure.code).toBe('not_configured');
    expect(called).toBe(false);
  });

  it('sends the requested window as a platform sort filter and clamps the limit', async () => {
    let requested = '';
    const source = createZhihuSource({
      accessSecret: () => 'secret',

      fetch: async input => {
        requested = String(input);
        return jsonResponse({
          Code: 0,
          Data: { Items: [] },
        });
      },
    });

    await source.search({
      query: '摄影',
      limit: 50,
      timeRange: {
        from: 1_700_000_000_000,
        to: 1_800_000_000_000,
      },
    });

    const url = new URL(requested);

    expect(url.searchParams.get('Query')).toBe('摄影');
    expect(url.searchParams.get('Count')).toBe('10');
    expect(url.searchParams.get('SortBy')).toBe('EditTime:desc:(1700000000,1800000000)');
  });

  it('maps a platform throttling code to a retryable failure', async () => {
    const source = createZhihuSource({
      accessSecret: () => 'secret',

      fetch: async () =>
        jsonResponse({
          Code: 30001,
          Message: '频率限制',
        }),
    });

    const result = await source.search({
      query: '摄影',
      limit: 5,
    });

    expect(result.status).toBe('failed');

    if (result.status !== 'failed') throw new Error('expected a failure');

    expect(result.failure.code).toBe('rate_limited');
    expect(result.failure.retryable).toBe(true);
  });

  it('maps an authentication code to a non-retryable failure', async () => {
    const source = createZhihuSource({
      accessSecret: () => 'secret',

      fetch: async () =>
        jsonResponse({
          Code: 20001,
          Message: '鉴权失败',
        }),
    });

    const result = await source.search({
      query: '摄影',
      limit: 5,
    });

    expect(result.status).toBe('failed');

    if (result.status !== 'failed') throw new Error('expected a failure');

    expect(result.failure.code).toBe('unauthorized');
    expect(result.failure.retryable).toBe(false);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
