/* Verifies source text and creation metadata without inventing facts from navigation. */
// @vitest-environment node
import https from 'node:https';
import { expect, it, vi, onTestFinished } from 'vitest';
import { createDirectWebSource } from '@megumi/application/recommendation/sources/direct-web-source';
import { ToolExecutionFailure } from '@megumi/agent/tools/tool-result';

it('retries a transient public page failure before retaining the acquired article', async () => {
  vi.useFakeTimers();

  try {
    let attempts = 0;
    const source = createDirectWebSource({
      webFetch: {
        fetch: async request => {
          if (++attempts === 1)
            throw new ToolExecutionFailure('Network failed', 'tool_execution_failed', {
              reason: 'network_error',
            });

          return {
            requestedUrl: request.url,
            finalUrl: request.url,
            contentType: 'text/html',
            content: '正文',
            document: '<article>正文</article>',
            truncated: false,
          };
        },
      },
    });
    const pending = source.fetch({ url: 'https://example.com/article' });
    await vi.runAllTimersAsync();

    expect(await pending).toMatchObject({
      status: 'success',
      material: {
        text: '正文',
        kind: 'full_text',
      },
    });
    expect(attempts).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

it('stops at the physical request boundary when the material budget is exhausted', async () => {
  const transport = vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('Unexpected request');
  });
  onTestFinished(() => transport.mockRestore());
  const result = await createDirectWebSource().fetch({
    url: 'https://93.184.216.34/article',
    reserveRequest: () => false,
  });

  expect(result).toMatchObject({
    status: 'failed',
    failure: { code: 'budget_exhausted' },
  });
});

it('extracts article material and keeps creation and modification evidence separate', async () => {
  const source = createDirectWebSource({
    webFetch: {
      fetch: async () => ({
        requestedUrl: 'https://example.com/article',
        finalUrl: 'https://example.com/article',
        contentType: 'text/html',
        content: 'Navigation Article',
        truncated: false,
        document:
          '<html><head><title>原文</title><script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-06T12:00:00Z","dateModified":"2026-10-07T00:00:00Z","author":{"name":"作者"}}</script></head><body><nav>登录 菜单</nav><article><p>React 渲染流程。</p></article></body></html>',
      }),
    },
  });

  expect(await source.fetch({ url: 'https://example.com/article' })).toMatchObject({
    status: 'success',
    material: {
      text: 'React 渲染流程。',
      author: '作者',
      kind: 'full_text',
      method: 'direct_web',
      publicationEvidence: [
        {
          kind: 'published',
          value: '2026-10-06T12:00:00Z',
          status: 'verified',
        },
        {
          kind: 'modified',
          status: 'unverified',
        },
      ],
    },
  });
});

it.each([
  ['安全验证', '请完成访问验证', 'challenge_required'],
  ['登录', '登录后查看全文', 'login_required'],
  ['空页面', '', 'material_unavailable'],
] as const)(
  'reports %s without saving the page as article material',
  async (title, content, code) => {
    const source = createDirectWebSource({
      webFetch: {
        fetch: async () => ({
          requestedUrl: 'https://example.com/1',
          finalUrl: 'https://example.com/1',
          title,
          contentType: 'text/html',
          content,
          document: `<html><title>${title}</title><body>${content}</body></html>`,
          truncated: false,
        }),
      },
    });

    expect(await source.fetch({ url: 'https://example.com/1' })).toMatchObject({
      status: 'failed',
      failure: { code },
    });
  },
);

it('extracts a graph article date without treating the publisher metadata as publication', async () => {
  const document =
    '<script type="application/ld+json">{"@graph":[{"@type":"Organization","datePublished":"2020-01-01"},{"@type":"Article","datePublished":"2026-10-06"}]}</script><main>正文材料</main>';
  const source = createDirectWebSource({
    webFetch: {
      fetch: async () => ({
        requestedUrl: 'https://example.com/1',
        finalUrl: 'https://example.com/1',
        contentType: 'text/html',
        content: '正文材料',
        document,
        truncated: false,
      }),
    },
  });

  expect(await source.fetch({ url: 'https://example.com/1' })).toMatchObject({
    status: 'success',
    material: {
      publicationEvidence: [
        {
          value: '2026-10-06',
          precision: 'date',
          timezone: null,
          status: 'verified',
        },
      ],
    },
  });
});
