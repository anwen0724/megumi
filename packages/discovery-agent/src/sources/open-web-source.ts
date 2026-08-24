/* Adapts the existing provider-neutral Web Search and Web Fetch interfaces as a discovery source. */
import {
  ToolExecutionFailure,
  type WebFetch,
  type WebSearch,
} from '@megumi/tools';
import {
  SourceContentDetailSchema,
  SourceContentSchema,
  type DiscoverySource,
  type SourceFailure,
} from './discovery-source';

export function createOpenWebSource(input: {
  readonly webSearch?: WebSearch;
  readonly webFetch?: WebFetch;
}): DiscoverySource {
  return {
    descriptor: { id: 'open_web', name: 'Open Web', access: 'public', supportedModes: ['relevance'] },
    getAvailability: () => ({ state: input.webSearch ? 'ready' : 'not_configured' }),
    async search(request) {
      if (!input.webSearch) return failed('not_configured', 'Open Web search is not configured.', false);
      try {
        const result = await input.webSearch.search({
          query: request.query.trim(),
          count: request.limit,
          signal: request.signal,
        });
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
            return [];
          }
        });
        return { status: 'success', items };
      } catch (error) {
        return { status: 'failed', failure: toolFailure(error, request.signal) };
      }
    },
    async read(request) {
      if (!input.webFetch) return failed('not_configured', 'Open Web reading is not configured.', false);
      try {
        const result = await input.webFetch.fetch({ url: request.url, signal: request.signal });
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

function siteName(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
}

function failed(code: SourceFailure['code'], message: string, retryable: boolean) {
  return { status: 'failed' as const, failure: { code, message, retryable } };
}

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
