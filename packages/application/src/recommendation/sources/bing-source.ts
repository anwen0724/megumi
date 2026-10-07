/* Adapts the existing no-key Bing RSS service to discovery material contracts. */
import type { SourceConnector, SourceSearchRequest, SourceSearchResult } from './source-connector';
import { createBingRssWebSearch } from '@megumi/agent/tools/builtin/web/search-web';
import { ToolExecutionFailure } from '@megumi/agent/tools/tool-result';
import { identifyContentUrl, publicationClaim } from './source-material';
import { sourceFailure, retrySourceRequest } from './source-http';

export function createBingSource(options: { fetch?: typeof globalThis.fetch } = {}): SourceConnector {
  const search = createBingRssWebSearch(options);
  async function searchOnce(request: SourceSearchRequest): Promise<SourceSearchResult> {
    if (request.signal?.aborted) return sourceFailure('cancelled', 'Bing search was cancelled.');
    if (request.reserveRequest && !request.reserveRequest('search')) return sourceFailure('budget_exhausted', 'Source request budget was exhausted.');
    try {
      const result = await search.search({ query: request.query, count: Math.min(20, request.limit), signal: request.signal });
      return {
        status: 'success', items: result.results.flatMap((item) => {
          const identity = identifyContentUrl(item.url);
          return identity ? [{
            ...identity,
            source: 'bing_rss',
            method: 'bing_rss',
            title: item.title,
            text: item.snippet,
            kind: 'excerpt' as const,
            truncated: false,
            rangeStart: 0,
            rangeEnd: [...item.snippet].length,
            publicationEvidence: item.publishedDate ? [publicationClaim(item.publishedDate, 'RSS.pubDate')] : []
          }] : [];
        })
      };
    } catch (error) {
      if (request.signal?.aborted) return sourceFailure('cancelled', 'Bing search was cancelled.');
      if (error instanceof ToolExecutionFailure) {
        const reason = error.details?.reason;
        return sourceFailure(
          reason === 'response_too_large' ? 'material_too_large' : reason === 'authentication_failed' ? 'unauthorized' : reason === 'http_error' ? 'unavailable' : reason === 'invalid_response' ? 'invalid_response' : reason === 'timeout' ? 'timeout' : reason === 'rate_limited' ? 'rate_limited' : 'network_error',
          'Bing search failed.'
        );
      }
      return sourceFailure('network_error', 'Bing search failed.');
    }
  }

  return {
    managesRequestBudget: true,
    id: 'bing_rss',
    descriptor: {
      id: 'bing_rss',
      description: '免密钥公开网页搜索。',
      accessPaths: ['public'],
      maxResultsPerSearch: 20,
      supportsTimeRange: false,
      material: 'excerpt',
      supportsFetch: false
    },
    search(request) { return retrySourceRequest(() => searchOnce(request), request.signal); },
    async fetch() { return { status: 'failed', failure: { code: 'unsupported', message: 'Bing does not fetch material.', retryable: false } }; },
  };
}
