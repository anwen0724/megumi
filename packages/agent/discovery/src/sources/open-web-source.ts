/*
 * Adapts the provider-neutral Web Search and Web Fetch interfaces as a Discovery Source.
 */
import {
  ToolExecutionFailure,
  type WebFetch,
  type WebSearch,
} from '@megumi/tools';
import {
  reportSourceProviderResponse,
  SourceContentDetailSchema,
  SourceContentSchema,
  type DiscoverySource,
  type SourceFailure,
} from './discovery-source';

/** Creates the Open Web Source from the configured Harness search and fetch capabilities. */
export function createOpenWebSource(input: {
  readonly webSearch?: WebSearch | (() => WebSearch | undefined);
  readonly webFetch?: WebFetch;
  readonly provider?: () => string | undefined;
}): DiscoverySource {
  let checkedAt: string | undefined;
  const availability = () => {
    const provider = input.provider?.();
    return {
      state: resolveWebSearch(input.webSearch) ? 'ready' as const : 'not_configured' as const,
      ...(provider ? { provider } : {}),
      ...(checkedAt ? { checkedAt } : {}),
    };
  };
  return {
    descriptor: {
      id: 'open_web',
      name: 'Open Web',
      access: 'configured_provider',
      supportedModes: ['relevance'],
      supportsRead: Boolean(input.webFetch),
    },
    getAvailability: availability,
    async checkAvailability() {
      checkedAt = new Date().toISOString();
      return availability();
    },
    async search(request) {
      const webSearch = resolveWebSearch(input.webSearch);
      if (!webSearch) return failed('not_configured', 'Open Web search is not configured.', false);
      try {
        const result = await webSearch.search({
          query: request.query.trim(),
          count: request.limit,
          signal: request.signal,
        });
        reportSourceProviderResponse(request.onProviderResponse, result);
        const items = result.results.flatMap((entry) => {
          try {
            const canonicalUrl = new URL(entry.url).toString();
            return [SourceContentSchema.parse({
              sourceId: 'open_web',
              sourceName: siteName(canonicalUrl),
              canonicalUrl,
              contentType: 'page',
              title: entry.title,
              ...(entry.snippet.trim() ? { description: entry.snippet } : {}),
            })];
          } catch {
            // One malformed provider result must not discard the rest of the search response.
            return [];
          }
        });
        checkedAt = new Date().toISOString();
        return { status: 'success', items };
      } catch (error) {
        checkedAt = new Date().toISOString();
        return { status: 'failed', failure: toolFailure(error, request.signal) };
      }
    },
    async read(request) {
      if (!input.webFetch) return failed('not_configured', 'Open Web reading is not configured.', false);
      try {
        const result = await input.webFetch.fetch({ url: request.url, signal: request.signal });
        reportSourceProviderResponse(request.onProviderResponse, result);
        return {
          status: 'success',
          detail: SourceContentDetailSchema.parse({
            sourceId: 'open_web',
            sourceName: siteName(result.finalUrl),
            canonicalUrl: result.finalUrl,
            contentType: 'page',
            title: result.title?.trim() || siteName(result.finalUrl),
            ...(result.content.trim() ? { contentText: result.content } : {}),
          }),
        };
      } catch (error) {
        return { status: 'failed', failure: toolFailure(error, request.signal) };
      }
    },
  };
}

function resolveWebSearch(input: WebSearch | (() => WebSearch | undefined) | undefined): WebSearch | undefined {
  return typeof input === 'function' ? input() : input;
}

function siteName(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
}

function failed(code: SourceFailure['code'], message: string, retryable: boolean) {
  return { status: 'failed' as const, failure: { code, message, retryable } };
}

/** Converts Harness Tool failures into the stable Discovery Source failure contract. */
function toolFailure(error: unknown, signal: AbortSignal): SourceFailure {
  if (signal.aborted) return { code: 'cancelled', message: 'Open Web request was cancelled.', retryable: false };
  if (error instanceof ToolExecutionFailure) {
    const reason = typeof error.details?.reason === 'string' ? error.details.reason : undefined;
    const statusCode = typeof error.details?.statusCode === 'number' ? error.details.statusCode : undefined;
    if (reason === 'cancelled') return { code: 'cancelled', message: error.message, retryable: false };
    if (reason === 'not_configured') return { code: 'not_configured', message: error.message, retryable: false };
    if (reason === 'timeout') return { code: 'timeout', message: error.message, retryable: true };
    if (reason === 'http_429' || statusCode === 429) {
      return { code: 'rate_limited', message: error.message, retryable: true };
    }
  }
  return {
    code: 'network_error',
    message: error instanceof Error ? error.message : 'Open Web request failed.',
    retryable: true,
  };
}
