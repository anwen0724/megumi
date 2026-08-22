/* Protects provider-neutral Web Tools, cancellation, credential safety, and SSRF blocking. */

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createBingRssWebSearch,
  createBraveWebSearch,
  createFallbackWebSearch,
  createWebFetch,
  createWebSearch,
} from '../../../packages/tools/src';
import { createBuiltInTestHarness } from './built-in-test-harness';
import {
  isAllowedResolvedAddress,
  isPublicIp,
} from '../../../packages/tools/src/built-ins/web-fetch';
import { createLocalWorkspaceFileAccess } from './tool-test-fixtures';

describe('web_search built-in Tool', () => {
  it('normalizes Brave Search results without exposing its credential', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      web: { results: [{
        title: '<strong>Megumi</strong> docs',
        url: 'https://example.com/docs',
        description: 'Current &amp; official <strong>documentation</strong>.',
      }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const tools = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      webSearch: createBraveWebSearch({ apiKey: 'search-secret', fetch: fetch as typeof globalThis.fetch }),
    });
    const result = await tools.execute({
      toolName: 'web_search', input: { query: 'Megumi documentation', count: 3 },
    });
    expect(result).toMatchObject({ type: 'succeeded', normalizedResult: { kind: 'json' } });
    expect(JSON.parse(result.normalizedResult.content)).toEqual({
      query: 'Megumi documentation',
      results: [{
        title: 'Megumi docs',
        url: 'https://example.com/docs',
        snippet: 'Current & official documentation.',
      }],
    });
    expect(JSON.stringify(result)).not.toContain('search-secret');
  });

  it.each([
    ['tavily', { results: [{ title: 'Tavily', url: 'https://example.com/t', content: 'Tavily snippet' }] }],
    ['exa', { results: [{ title: 'Exa', url: 'https://example.com/e', highlights: ['Exa snippet'] }] }],
    ['custom', { results: [{ title: 'Custom', url: 'https://example.com/c', snippet: 'Custom snippet' }] }],
  ] as const)('normalizes the %s provider behind the same interface', async (provider, response) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    const webSearch = createWebSearch({
      provider,
      apiKey: 'search-secret',
      ...(provider === 'custom' ? { baseUrl: 'https://search.example.com/query' } : {}),
      fetch: fetch as typeof globalThis.fetch,
    });
    await expect(webSearch.search({ query: 'Megumi', count: 2 })).resolves.toMatchObject({
      query: 'Megumi', results: [{ url: expect.stringContaining('https://example.com/') }],
    });
  });

  it('cancels the provider request with the Tool execution', async () => {
    const fetch = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
      })
    ));
    const tools = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      webSearch: createBraveWebSearch({ apiKey: 'search-secret', fetch: fetch as typeof globalThis.fetch }),
    });
    const controller = new AbortController();
    const pending = tools.execute(
      { toolName: 'web_search', input: { query: 'cancel me' } },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).resolves.toMatchObject({ type: 'failed', error: { code: 'tool_cancelled' } });
  });

  it('normalizes provider authentication failure without exposing the credential', async () => {
    const tools = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      webSearch: createBraveWebSearch({
        apiKey: 'search-secret',
        fetch: vi.fn(async () => new Response('', { status: 401 })) as typeof globalThis.fetch,
      }),
    });
    const result = await tools.execute({
      toolName: 'web_search', input: { query: 'Megumi' },
    });
    expect(result).toMatchObject({
      type: 'failed',
      error: { message: 'Web search authentication failed.', details: { statusCode: 401 } },
    });
    expect(JSON.stringify(result)).not.toContain('search-secret');
  });

  it('searches the public web through the no-key Bing RSS endpoint', async () => {
    const fetch = vi.fn(async () => new Response(`<?xml version="1.0" encoding="utf-8"?>
      <rss><channel><item>
        <title>秋招 &amp; 面试经验</title>
        <link>https://example.com/campus</link>
        <description><![CDATA[<b>真实</b>面试复盘]]></description>
      </item></channel></rss>`, {
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
    }));
    const search = createBingRssWebSearch({ fetch: fetch as typeof globalThis.fetch });

    await expect(search.search({ query: '秋招面试经验', count: 5 })).resolves.toEqual({
      query: '秋招面试经验',
      results: [{
        title: '秋招 & 面试经验',
        url: 'https://example.com/campus',
        snippet: '真实面试复盘',
      }],
    });
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.hostname).toBe('www.bing.com');
    expect(url.searchParams.get('format')).toBe('rss');
  });

  it('falls back after a configured provider fails or returns no results', async () => {
    const configured = {
      search: vi.fn()
        .mockRejectedValueOnce(new Error('provider unavailable'))
        .mockResolvedValueOnce({ query: 'empty', results: [] }),
    };
    const fallback = {
      search: vi.fn(async ({ query }: { query: string }) => ({
        query,
        results: [{ title: 'Fallback', url: 'https://example.com/fallback', snippet: 'Available' }],
      })),
    };
    const search = createFallbackWebSearch([configured, fallback]);

    await expect(search.search({ query: 'failed', count: 5 })).resolves.toMatchObject({
      results: [{ title: 'Fallback' }],
    });
    await expect(search.search({ query: 'empty', count: 5 })).resolves.toMatchObject({
      results: [{ title: 'Fallback' }],
    });
    expect(fallback.search).toHaveBeenCalledTimes(2);
  });
});

describe('web_fetch built-in Tool', () => {
  it('returns a provider-neutral page from an injected network interface', async () => {
    const tools = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      webFetch: {
        async fetch({ url }) {
          return {
            requestedUrl: url,
            finalUrl: 'https://example.com/final',
            title: 'Example',
            contentType: 'text/html',
            content: 'Readable content',
            truncated: false,
          };
        },
      },
    });
    const result = await tools.execute({
      toolName: 'web_fetch', input: { url: 'https://example.com' },
    });
    expect(JSON.parse(result.normalizedResult.content)).toMatchObject({
      requestedUrl: 'https://example.com', finalUrl: 'https://example.com/final', content: 'Readable content',
    });
  });

  it('blocks private and local addresses with a safe structured reason', async () => {
    const tools = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      webFetch: createWebFetch(),
    });
    await expect(tools.execute({
      toolName: 'web_fetch', input: { url: 'http://127.0.0.1/private' },
    })).resolves.toMatchObject({
      type: 'failed',
      error: { message: expect.stringMatching(/private|local|non-public/), details: { reason: 'blocked_address' } },
    });
  });

  it.each([
    ['not a URL', 'invalid_url'],
    ['ftp://example.com/file', 'invalid_url'],
    ['https://user:password@example.com/private', 'invalid_url'],
    ['http://localhost/private', 'blocked_address'],
    ['http://service.localhost/private', 'blocked_address'],
  ])('rejects unsafe target %s before opening a connection', async (url, reason) => {
    await expect(createWebFetch().fetch({ url })).rejects.toMatchObject({
      code: 'tool_execution_failed',
      details: { reason },
    });
  });

  it('honors cancellation before opening a connection to a public literal address', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createWebFetch().fetch({
      url: 'http://1.1.1.1/',
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'tool_cancelled', details: { reason: 'cancelled' } });
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
  ])('allows public address %s', (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it('allows synthetic proxy addresses only after hostname resolution', () => {
    expect(isPublicIp('198.18.0.32')).toBe(false);
    expect(isAllowedResolvedAddress('198.18.0.32', 'hostname')).toBe(true);
    expect(isAllowedResolvedAddress('198.18.0.32', 'literal')).toBe(false);
  });
});
