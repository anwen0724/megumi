/* Verifies the Open Web adapter over the existing Web Search and Web Fetch seams. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionFailure, type WebFetch, type WebSearch } from '@megumi/tools';
import { createOpenWebSource } from '@megumi/discovery';

describe('Open Web discovery source', () => {
  it('preserves the actual website name instead of presenting Open Web as the publisher', async () => {
    const webSearch: WebSearch = {
      search: vi.fn(async () => ({
        query: 'agent harness',
        results: [
          { title: 'Agent engineering', url: 'https://www.example.com/posts/agent', snippet: 'A practical article.' },
          { title: 'Repository', url: 'https://github.com/acme/agent', snippet: '' },
        ],
      })),
    };
    const source = createOpenWebSource({ webSearch });

    const result = await source.search({
      query: ' agent harness ', mode: 'relevance', limit: 2, signal: new AbortController().signal,
    });

    expect(webSearch.search).toHaveBeenCalledWith(expect.objectContaining({ query: 'agent harness', count: 2 }));
    expect(result).toEqual({
      status: 'success',
      items: [
        expect.objectContaining({ sourceId: 'open_web', sourceName: 'example.com', title: 'Agent engineering' }),
        expect.objectContaining({ sourceId: 'open_web', sourceName: 'github.com', title: 'Repository' }),
      ],
    });
  });

  it('returns not_configured without trying a network call when Web Search is unavailable', async () => {
    const result = await createOpenWebSource({}).search({
      query: 'agent', mode: 'relevance', limit: 5, signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: 'failed', failure: { code: 'not_configured', retryable: false } });
  });

  it('reflects credentials saved after startup through the injected provider resolver', async () => {
    let configured: WebSearch | undefined;
    const source = createOpenWebSource({ webSearch: () => configured });
    expect(source.getAvailability()).toEqual({ state: 'not_configured' });

    configured = { search: vi.fn(async () => ({ query: 'agent', results: [] })) };

    expect(source.getAvailability()).toEqual({ state: 'ready' });
    await expect(source.search({
      query: 'agent', mode: 'relevance', limit: 5, signal: new AbortController().signal,
    })).resolves.toEqual({ status: 'success', items: [] });
  });

  it.each([
    ['timeout', 'timeout'],
    ['cancelled', 'cancelled'],
    ['http_429', 'rate_limited'],
    ['network_error', 'network_error'],
  ] as const)('maps Web Search %s failures to %s', async (reason, expectedCode) => {
    const webSearch: WebSearch = {
      search: vi.fn(async () => {
        throw new ToolExecutionFailure('failed', 'tool_execution_failed', { reason });
      }),
    };

    const result = await createOpenWebSource({ webSearch }).search({
      query: 'agent', mode: 'relevance', limit: 5, signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: 'failed', failure: { code: expectedCode } });
  });

  it('uses Web Fetch for optional candidate reading', async () => {
    const webFetch: WebFetch = {
      fetch: vi.fn(async () => ({
        requestedUrl: 'https://example.com/post',
        finalUrl: 'https://news.example.com/post',
        title: 'Detailed title',
        contentType: 'text/html',
        content: 'Full extracted content',
        truncated: false,
      })),
    };
    const source = createOpenWebSource({ webFetch });

    const result = await source.read!({
      url: 'https://example.com/post', signal: new AbortController().signal,
    });

    expect(result).toEqual({ status: 'success', detail: expect.objectContaining({
      sourceName: 'news.example.com', canonicalUrl: 'https://news.example.com/post', contentText: 'Full extracted content',
    }) });
  });
});
