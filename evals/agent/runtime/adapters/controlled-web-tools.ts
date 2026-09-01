/* Returns deterministic external Web Search and Fetch facts from one validated Fixture. */
import type { WebFetch, WebSearch } from '@megumi/tools';
import type { EvaluationFixture } from '../../fixtures/fixture';

export function createControlledWebTools(fixture: EvaluationFixture): {
  readonly webSearch: WebSearch;
  readonly webFetch: WebFetch;
} {
  const results = fixture.controlledSearch;
  return {
    webSearch: {
      async search(request) {
        request.signal?.throwIfAborted();
        const match = results.find((entry) => request.query.includes(entry.queryIncludes));
        return {
          query: request.query,
          results: (match?.results ?? []).slice(0, request.count).map((entry) => ({
            title: entry.title,
            url: entry.url,
            snippet: entry.snippet ?? entry.content ?? '',
          })),
        };
      },
    },
    webFetch: {
      async fetch(request) {
        request.signal?.throwIfAborted();
        const result = results.flatMap((entry) => entry.results).find((entry) => entry.url === request.url);
        if (!result) throw new Error(`Controlled Web Fetch has no Fixture result for ${request.url}.`);
        return {
          requestedUrl: request.url,
          finalUrl: result.url,
          title: result.title,
          contentType: 'text/plain',
          content: result.content ?? result.snippet ?? '',
          truncated: false,
        };
      },
    },
  };
}

