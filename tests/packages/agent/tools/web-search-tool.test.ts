/* Verifies the built-in web search contract and Brave Search API boundary. */
import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionService, ToolRegistryService } from '@megumi/agent/tools';
import {
  createBraveWebSearchService,
  createBuiltInToolExecutor,
  createWebSearchService,
  type WorkspaceFileAccess,
} from '@megumi/agent/tools/built-in-tools';

describe('web_search built-in tool', () => {
  it('calls Brave Search and returns structured plain-text results', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      web: {
        results: [{
          title: '<strong>Megumi</strong> docs',
          url: 'https://example.com/docs',
          description: 'Current &amp; official <strong>documentation</strong>.',
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const service = createToolService(fetch as typeof globalThis.fetch);

    const result = await service.executeTool({
      toolName: 'web_search',
      input: { query: 'Megumi documentation', count: 3 },
    });

    expect(result).toMatchObject({
      type: 'succeeded',
      rawResult: {
        content: {
          query: 'Megumi documentation',
          results: [{
            title: 'Megumi docs',
            url: 'https://example.com/docs',
            snippet: 'Current & official documentation.',
          }],
        },
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining('q=Megumi+documentation'),
      }),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-subscription-token': 'search-secret',
        }),
      }),
    );
  });

  it('normalizes provider authentication failures without exposing the credential', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 401 }));
    const service = createToolService(fetch as typeof globalThis.fetch);

    const result = await service.executeTool({
      toolName: 'web_search',
      input: { query: 'test' },
    });

    expect(result).toMatchObject({
      type: 'failed',
      error: {
        code: 'tool_execution_failed',
        message: 'Web search authentication failed.',
      },
    });
    expect(JSON.stringify(result)).not.toContain('search-secret');
  });

  it('cancels the provider request when the Agent Run cancels the tool call', async () => {
    const fetch = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('request aborted'));
        }, { once: true });
      })
    ));
    const service = createToolService(fetch as typeof globalThis.fetch);
    const controller = new AbortController();

    const pending = service.executeTool({
      toolName: 'web_search',
      input: { query: 'cancel me' },
      options: { signal: controller.signal },
    });
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      type: 'failed',
      error: { code: 'tool_cancelled' },
    });
  });
});

describe('web_search provider adapters', () => {
  it.each([
    {
      provider: 'tavily' as const,
      response: { results: [{ title: 'Tavily result', url: 'https://example.com/t', content: 'Tavily snippet' }] },
      expectedHeader: ['authorization', 'Bearer search-secret'],
      expectedBody: { max_results: 2 },
    },
    {
      provider: 'exa' as const,
      response: { results: [{ title: 'Exa result', url: 'https://example.com/e', highlights: ['Exa snippet'] }] },
      expectedHeader: ['x-api-key', 'search-secret'],
      expectedBody: { numResults: 2 },
    },
    {
      provider: 'custom' as const,
      response: { results: [{ title: 'Custom result', url: 'https://example.com/c', snippet: 'Custom snippet' }] },
      expectedHeader: ['authorization', 'Bearer search-secret'],
      expectedBody: { count: 2 },
    },
  ])('normalizes $provider results behind one contract', async ({ provider, response, expectedHeader, expectedBody }) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    const service = createWebSearchService({
      provider,
      apiKey: 'search-secret',
      ...(provider === 'custom' ? { baseUrl: 'https://search.example.com/query' } : {}),
      fetch: fetch as typeof globalThis.fetch,
    });

    const result = await service.search({ query: 'Megumi', count: 2 });
    expect(result.results).toHaveLength(1);
    const [, init] = (fetch.mock.calls as unknown as Array<[URL, RequestInit]>)[0];
    expect((init?.headers as Record<string, string>)[expectedHeader[0]]).toBe(expectedHeader[1]);
    expect(JSON.parse(String(init?.body))).toMatchObject(expectedBody);
  });
});

function createToolService(fetch: typeof globalThis.fetch): ToolExecutionService {
  return new ToolExecutionService({
    registryService: new ToolRegistryService({ disabledBuiltInTools: [] }),
    builtInTools: createBuiltInToolExecutor({
      workspaceFileAccess: unusedWorkspaceFileAccess(),
      webSearchService: createBraveWebSearchService({
        apiKey: 'search-secret',
        fetch,
      }),
    }),
  });
}

function unusedWorkspaceFileAccess(): WorkspaceFileAccess {
  return {
    readFile: async () => { throw new Error('Not used'); },
    listDirectory: async () => { throw new Error('Not used'); },
    walkFiles: async () => { throw new Error('Not used'); },
    readTextFile: async () => { throw new Error('Not used'); },
    replaceText: async () => { throw new Error('Not used'); },
    writeFile: async () => { throw new Error('Not used'); },
    resolveCommandCwd: async () => { throw new Error('Not used'); },
  };
}
