/*
 * Executes provider-neutral web searches through Settings-selected provider adapters.
 * Provider credentials are resolved for every call so configuration changes apply to the next Run.
 */
import type { WebSearchProvider } from '../../settings';
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, optionalPositiveInteger, requireString } from './input';
import type { BuiltInToolContext } from './types';
import { ToolExecutionFailure } from '../core/tool-execution-failure';

const DEFAULT_RESULT_COUNT = 5;
const MAX_RESULT_COUNT = 20;
const DEFAULT_TIMEOUT_MS = 15_000;

export type WebSearchRequest = { query: string; count: number; signal?: AbortSignal };
export type WebSearchResultItem = { title: string; url: string; snippet: string };
export type WebSearchResult = { query: string; results: WebSearchResultItem[] };

export interface WebSearchService {
  search(request: WebSearchRequest): Promise<WebSearchResult>;
}

export type WebSearchRuntimeConfig = {
  provider: WebSearchProvider;
  apiKey: string;
  baseUrl?: string;
};

export async function executeWebSearch(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  if (!context.webSearchService) throw new Error('web_search is not configured.');
  const record = inputRecord(input);
  const query = requireString(record, 'query').trim();
  const count = optionalPositiveInteger(record, 'count', DEFAULT_RESULT_COUNT);
  if (count > MAX_RESULT_COUNT) throw new Error(`web_search count must be <= ${MAX_RESULT_COUNT}.`);
  const result = await context.webSearchService.search({ query, count, signal });
  return {
    outputKind: 'json',
    content: result,
    metadata: { query, resultCount: result.results.length },
  };
}

export function createWebSearchService(input: WebSearchRuntimeConfig & {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): WebSearchService {
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

export function createBraveWebSearchService(input: {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): WebSearchService {
  return createWebSearchService({ provider: 'brave', ...input });
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
