/* Implements Tavily search and per-URL material extraction. */
import { z } from 'zod';
import type { SourceConnector, SourceSearchResult } from './source-connector';
import { budgetedSourceFetch, requestSourceJson } from './source-http';
import { boundedMaterial, identifyContentUrl, publicationClaim } from './source-material';

export function createTavilySource(options: {
  accessSecret(): string | undefined;
  fetch?: typeof globalThis.fetch;
}): SourceConnector {
  const fetch = options.fetch ?? globalThis.fetch;
  return {
    managesRequestBudget: true,
    id: 'tavily',
    descriptor: {
      id: 'tavily',
      description: '公开网页搜索与材料获取。',
      accessPaths: ['credential'],
      maxResultsPerSearch: 20,
      supportsTimeRange: true,
      material: 'excerpt',
      supportsFetch: true
    },
    async search(request): Promise<SourceSearchResult> {
      const secret = options.accessSecret()?.trim();
      if (!secret) return {
        status: 'failed', failure: {
          code: 'not_configured',
          message: 'Tavily key is not configured.',
          retryable: false
        }
      };
      const response = await requestSourceJson(budgetedSourceFetch(fetch, request.reserveRequest, 'search'), 'https://api.tavily.com/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify({
          query: request.query,
          search_depth: 'basic',
          include_answer: false,
          include_published_date: true,
          max_results: Math.max(1, Math.min(20, request.limit)),
          ...(request.timeRange?.from !== undefined ? { start_date: new Date(request.timeRange.from).toISOString().slice(0, 10) } : {}),
          ...(request.timeRange?.to !== undefined ? { end_date: new Date(request.timeRange.to).toISOString().slice(0, 10) } : {}),
        }),
      }, z.object({
        results: z.array(z.object({
          title: z.string(),
          url: z.string().url(),
          content: z.string(),
          raw_content: z.string().nullable().optional(),
          published_date: z.string().nullable().optional()
        }))
      }));
      if (response.status === 'failed') return response;
      const payload = response.payload;
      return {
        status: 'success', items: payload.results.slice(0, request.limit).flatMap((item) => {
          const identity = identifyContentUrl(item.url);
          if (!identity) return [];
          return [{
            ...identity,
            source: 'tavily',
            method: 'tavily_search',
            requestUrl: identity.platform === 'xiaohongshu' ? item.url : undefined,
            title: item.title,
            ...boundedMaterial(item.raw_content || item.content),
            kind: item.raw_content ? 'full_text' as const : 'excerpt' as const,
            publicationEvidence: item.published_date ? [publicationClaim(item.published_date, 'Tavily.results.published_date')] : [],
          }];
        })
      };
    },
    async fetch(request) {
      const secret = options.accessSecret()?.trim();
      if (!secret) return {
        status: 'failed', failure: {
          code: 'not_configured',
          message: 'Tavily key is not configured.',
          retryable: false
        }
      };
      const response = await requestSourceJson(budgetedSourceFetch(fetch, request.reserveRequest, 'material'), 'https://api.tavily.com/extract', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify({ urls: [request.url], format: 'markdown' }),
      }, z.object({ results: z.array(z.object({ url: z.string(), raw_content: z.string() })), failed_results: z.array(z.object({ url: z.string(), error: z.string() })) }));
      if (response.status === 'failed') return response;
      const payload = response.payload;
      const item = payload.results.find((entry) => entry.url === request.url);
      if (!item?.raw_content.trim()) return {
        status: 'failed', failure: {
          code: 'material_unavailable',
          message: 'Tavily did not acquire material for this URL.',
          retryable: false
        }
      };
      return {
        status: 'success', material: {
          ...boundedMaterial(item.raw_content),
          kind: 'full_text',
          method: 'tavily_extract',
          publicationEvidence: []
        }
      };
    },
  };
}
