/*
 * Executes provider-neutral web searches through an injected provider adapter.
 * Provider credentials stay inside the adapter and never enter Tool results.
 */
import type { RawToolResult, ToolDefinition } from '../tool';
import { ToolExecutionFailure } from '../tool-result';
import { inputRecord, optionalPositiveInteger, requireString } from './tool-input';
import type { BuiltInToolContext } from './workspace-file-access';
import { createBuiltInToolHandler, operation } from './tool-handler';

const DEFAULT_RESULT_COUNT = 5;
const MAX_RESULT_COUNT = 20;
const DEFAULT_TIMEOUT_MS = 15_000;

export type WebSearchProvider = 'brave' | 'tavily' | 'exa' | 'custom';

export const webSearchToolDefinition: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web and return structured result summaries and URLs. Returns up to 5 results by default (maximum 20).',
  promptSnippet: 'Search the web and return result summaries.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string', minLength: 1, maxLength: 400,
        description: 'Search query. Use a focused query containing the important names and constraints.',
      },
      count: {
        type: 'integer', minimum: 1, maximum: 20,
        description: 'Optional number of search results. Defaults to 5.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      results: { type: 'array', items: { type: 'object', properties: {
        title: { type: 'string' }, url: { type: 'string' }, snippet: { type: 'string' },
      }, required: ['title', 'url', 'snippet'], additionalProperties: false } },
    },
    required: ['query', 'results'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
};

export type WebSearchRequest = { query: string; count: number; signal?: AbortSignal };
export type WebSearchResultItem = { title: string; url: string; snippet: string };
export type WebSearchResult = { query: string; results: WebSearchResultItem[] };

export interface WebSearch {
  search(request: WebSearchRequest): Promise<WebSearchResult>;
}

export type WebSearchRuntimeConfig = {
  provider: WebSearchProvider;
  apiKey: string;
  baseUrl?: string;
};

export const webSearchToolHandler = createBuiltInToolHandler({
  toolName: 'web_search',
  operations: (invocation) => [operation(invocation, 'network.search', {
    type: 'network.public_web',
  })],
  execute: (context, input, options) => executeWebSearch(context, input, options.signal),
});

export async function executeWebSearch(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  if (!context.webSearch) throw new Error('web_search is not configured.');
  const record = inputRecord(input);
  const query = requireString(record, 'query').trim();
  const count = optionalPositiveInteger(record, 'count', DEFAULT_RESULT_COUNT);
  if (count > MAX_RESULT_COUNT) throw new Error(`web_search count must be <= ${MAX_RESULT_COUNT}.`);
  const result = await context.webSearch.search({ query, count, signal });
  return {
    outputKind: 'json',
    content: result,
    metadata: { query, resultCount: result.results.length },
  };
}

export function createWebSearch(input: WebSearchRuntimeConfig & {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): WebSearch {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error('Web search API key is required.');
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async search(request) {
      validateRequest(request);
      const providerRequest = createProviderRequest(input, request);
      const response = await fetchWithTimeout(fetchImplementation, providerRequest.url, {
        method: providerRequest.method,
        headers: providerRequest.headers,
        ...(providerRequest.body ? { body: providerRequest.body } : {}),
        signal: request.signal,
        timeoutMs,
      });
      if (!response.ok) {
        throw new ToolExecutionFailure(
          webSearchHttpError(response.status),
          'tool_execution_failed',
          { reason: webSearchHttpReason(response.status), statusCode: response.status },
        );
      }
      const payload: unknown = await response.json();
      return {
        query: request.query.trim(),
        results: parseProviderResults(input.provider, payload).slice(0, request.count),
      };
    },
  };
}

export function createBraveWebSearch(input: {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): WebSearch {
  return createWebSearch({ provider: 'brave', ...input });
}

/** Creates a no-credential public Web Search over Bing's RSS response. */
export function createBingRssWebSearch(input: {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
} = {}): WebSearch {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async search(request) {
      validateRequest(request);
      const url = new URL('https://www.bing.com/search');
      url.searchParams.set('q', request.query.trim());
      url.searchParams.set('format', 'rss');
      url.searchParams.set('count', String(request.count));
      const response = await fetchWithTimeout(fetchImplementation, url, {
        method: 'GET',
        headers: {
          accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
          'user-agent': 'Mozilla/5.0 Megumi/0.1',
        },
        signal: request.signal,
        timeoutMs,
      });
      if (!response.ok) {
        throw new ToolExecutionFailure(
          webSearchHttpError(response.status),
          'tool_execution_failed',
          { reason: webSearchHttpReason(response.status), statusCode: response.status },
        );
      }
      const payload = await response.text();
      return {
        query: request.query.trim(),
        results: parseBingRssResults(payload).slice(0, request.count),
      };
    },
  };
}

/** Tries Web Search implementations in order, falling through on errors or empty results. */
export function createFallbackWebSearch(searches: readonly WebSearch[]): WebSearch {
  const providers = [...searches];
  return {
    async search(request) {
      let lastError: unknown;
      let completedQuery = request.query.trim();
      let sawSuccessfulProvider = false;
      for (const provider of providers) {
        try {
          const result = await provider.search(request);
          completedQuery = result.query;
          sawSuccessfulProvider = true;
          if (result.results.length > 0) return result;
        } catch (error) {
          if (isCancelledSearch(error, request.signal)) throw error;
          lastError = error;
        }
      }
      if (sawSuccessfulProvider) return { query: completedQuery, results: [] };
      if (lastError !== undefined) throw lastError;
      throw new ToolExecutionFailure(
        'Web search is not configured.',
        'tool_execution_failed',
        { reason: 'not_configured' },
      );
    },
  };
}

function createProviderRequest(
  config: WebSearchRuntimeConfig,
  request: WebSearchRequest,
): { url: URL; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string } {
  const query = request.query.trim();
  if (config.provider === 'brave') {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(request.count));
    url.searchParams.set('safesearch', 'moderate');
    return { url, method: 'GET', headers: { accept: 'application/json', 'x-subscription-token': config.apiKey } };
  }
  if (config.provider === 'tavily') {
    return jsonPost('https://api.tavily.com/search', config.apiKey, {
      query,
      search_depth: 'basic',
      max_results: request.count,
      include_answer: false,
      include_raw_content: false,
    });
  }
  if (config.provider === 'exa') {
    return {
      url: new URL('https://api.exa.ai/search'),
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': config.apiKey },
      body: JSON.stringify({ query, numResults: request.count, contents: { highlights: { maxCharacters: 600 } } }),
    };
  }
  if (!config.baseUrl) throw new Error('Custom web search Base URL is required.');
  const customUrl = new URL(config.baseUrl);
  if ((customUrl.protocol !== 'http:' && customUrl.protocol !== 'https:') || customUrl.username || customUrl.password) {
    throw new Error('Custom web search Base URL must be HTTP(S) without embedded credentials.');
  }
  return jsonPost(customUrl.toString(), config.apiKey, { query, count: request.count });
}

function jsonPost(url: string, apiKey: string, body: Record<string, unknown>) {
  return {
    url: new URL(url),
    method: 'POST' as const,
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  };
}

function parseProviderResults(provider: WebSearchProvider, payload: unknown): WebSearchResultItem[] {
  if (!isRecord(payload)) return [];
  const candidates = provider === 'brave'
    ? (isRecord(payload.web) && Array.isArray(payload.web.results) ? payload.web.results : [])
    : (Array.isArray(payload.results) ? payload.results : []);
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.title !== 'string' || typeof candidate.url !== 'string') return [];
    if (!isPublicHttpUrl(candidate.url)) return [];
    const snippet = provider === 'brave'
      ? candidate.description
      : provider === 'tavily'
        ? candidate.content
        : provider === 'exa'
          ? (Array.isArray(candidate.highlights) ? candidate.highlights[0] : candidate.text)
          : candidate.snippet;
    return [{ title: plainText(candidate.title), url: candidate.url, snippet: typeof snippet === 'string' ? plainText(snippet) : '' }];
  });
}

function parseBingRssResults(payload: string): WebSearchResultItem[] {
  const items = payload.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  return items.flatMap((item) => {
    const title = rssElement(item, 'title');
    const url = rssElement(item, 'link');
    if (!title || !url || !isPublicHttpUrl(url)) return [];
    return [{
      title: plainText(decodeXml(title)),
      url,
      snippet: plainText(decodeXml(rssElement(item, 'description') ?? '')),
    }];
  }).filter((item) => item.title.length > 0);
}

function rssElement(item: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(item);
  if (!match) return undefined;
  const value = match[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/i.exec(value);
  return (cdata?.[1] ?? value).trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function isCancelledSearch(error: unknown, signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted) || (
    error instanceof ToolExecutionFailure
    && (error.code === 'tool_cancelled' || error.details?.reason === 'cancelled')
  );
}

function validateRequest(request: WebSearchRequest): void {
  const query = request.query.trim();
  if (!query) throw new Error('Web search query must not be empty.');
  if (query.length > 400 || query.split(/\s+/).length > 50) throw new Error('Web search query exceeds the provider limit.');
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > MAX_RESULT_COUNT) {
    throw new Error(`Web search count must be between 1 and ${MAX_RESULT_COUNT}.`);
  }
}

async function fetchWithTimeout(
  fetchImplementation: typeof globalThis.fetch,
  url: URL,
  input: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  if (input.signal?.aborted) throw new Error('Web search was cancelled.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), input.timeoutMs);
  const cancel = () => controller.abort('cancelled');
  input.signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await fetchImplementation(url, {
      method: input.method,
      headers: input.headers,
      ...(input.body ? { body: input.body } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw new ToolExecutionFailure('Web search was cancelled.', 'tool_cancelled', { reason: 'cancelled' });
    }
    if (controller.signal.aborted) {
      throw new ToolExecutionFailure(
        `Web search timed out after ${input.timeoutMs}ms.`,
        'tool_execution_failed',
        { reason: 'timeout', timeoutMs: input.timeoutMs },
      );
    }
    if (error instanceof ToolExecutionFailure) throw error;
    throw new ToolExecutionFailure('Web search request failed.', 'tool_execution_failed', { reason: 'network_error' });
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', cancel);
  }
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch { return false; }
}

function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function webSearchHttpError(status: number): string {
  if (status === 401 || status === 403) return 'Web search authentication failed.';
  if (status === 429) return 'Web search rate limit exceeded.';
  return `Web search request failed with status ${status}.`;
}

function webSearchHttpReason(status: number): string {
  if (status === 401 || status === 403) return 'authentication_failed';
  if (status === 429) return 'rate_limited';
  return 'http_error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
