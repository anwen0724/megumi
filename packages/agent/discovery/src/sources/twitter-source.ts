/* Owns TwitterAPI.io Advanced Search, cursor paging, and Tweet normalization. */
import { SourceContentSchema, type DiscoverySource, type SourceFailure } from './discovery-source';

const SEARCH_URL = 'https://api.twitterapi.io/twitter/tweet/advanced_search';
const PROVIDER_PAGE_LIMIT = 20;

type FetchImplementation = typeof globalThis.fetch;

export function createTwitterSource(input: {
  readonly apiKey: () => string | undefined;
  readonly fetch?: FetchImplementation;
}): DiscoverySource {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  let availability: ReturnType<DiscoverySource['getAvailability']> = { state: 'unknown' };

  return {
    descriptor: {
      id: 'twitter',
      name: 'X (Twitter)',
      access: 'configured_provider',
      supportedModes: ['relevance', 'recent'],
      supportsRead: false,
    },
    getAvailability() {
      return input.apiKey()?.trim() ? availability : { state: 'not_configured' };
    },
    async search(request) {
      const apiKey = input.apiKey()?.trim();
      if (!apiKey) return failed('not_configured', 'TwitterAPI.io is not configured.', false);
      const requestedLimit = Math.min(PROVIDER_PAGE_LIMIT, Math.max(1, Math.floor(request.limit)));
      const tweets: unknown[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      try {
        do {
          const url = new URL(SEARCH_URL);
          url.searchParams.set('query', request.query.trim());
          url.searchParams.set('queryType', request.mode === 'recent' ? 'Latest' : 'Top');
          if (cursor) url.searchParams.set('cursor', cursor);
          const response = await fetchImplementation(url, {
            method: 'GET',
            headers: { 'X-API-Key': apiKey, accept: 'application/json' },
            signal: request.signal,
          });
          if (response.status === 429) {
            availability = { state: 'rate_limited', checkedAt: new Date().toISOString() };
            return failed('rate_limited', 'TwitterAPI.io rate limited the request.', true);
          }
          if (!response.ok) {
            return failed('invalid_response', `TwitterAPI.io returned HTTP ${response.status}.`, response.status >= 500);
          }
          const payload: unknown = await response.json();
          if (!isRecord(payload) || !Array.isArray(payload.tweets)) {
            return failed('invalid_response', 'TwitterAPI.io returned an invalid response.', false);
          }
          tweets.push(...payload.tweets);
          const next = stringValue(payload.next_cursor);
          const hasNext = payload.has_next_page === true && Boolean(next);
          if (!hasNext || !next || seenCursors.has(next)) break;
          seenCursors.add(next);
          cursor = next;
        } while (tweets.length < requestedLimit);
        availability = { state: 'ready', checkedAt: new Date().toISOString() };
        return { status: 'success', items: tweets.slice(0, requestedLimit).flatMap(normalizeTweet) };
      } catch (error) {
        if (request.signal.aborted) return failed('cancelled', 'TwitterAPI.io request was cancelled.', false);
        return failed('network_error', error instanceof Error ? error.message : 'TwitterAPI.io request failed.', true);
      }
    },
  };
}

function normalizeTweet(value: unknown) {
  if (!isRecord(value)) return [];
  const id = stringValue(value.id);
  const text = stringValue(value.text);
  if (!id || !text) return [];
  const author = isRecord(value.author) ? value.author : {};
  const username = stringValue(author.userName);
  const authorName = stringValue(author.name);
  const url = stringValue(value.url) ?? (username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/status/${id}`);
  const publishedAt = isoTimestamp(stringValue(value.createdAt));
  const engagement = {
    ...(nonnegativeInteger(value.viewCount) !== undefined ? { viewCount: nonnegativeInteger(value.viewCount) } : {}),
    ...(nonnegativeInteger(value.likeCount) !== undefined ? { likeCount: nonnegativeInteger(value.likeCount) } : {}),
    ...(nonnegativeInteger(value.replyCount) !== undefined ? { commentCount: nonnegativeInteger(value.replyCount) } : {}),
    ...(nonnegativeInteger(value.bookmarkCount) !== undefined ? { favoriteCount: nonnegativeInteger(value.bookmarkCount) } : {}),
  };
  try {
    return [SourceContentSchema.parse({
      sourceId: 'twitter',
      sourceName: 'X (Twitter)',
      sourceContentId: id,
      canonicalUrl: new URL(url).toString(),
      contentType: 'post',
      title: tweetTitle(text),
      ...(authorName || username ? { author: authorName && username ? `${authorName} (@${username})` : authorName ?? `@${username}` } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      description: text,
      ...(Object.keys(engagement).length > 0 ? { engagement } : {}),
    })];
  } catch {
    return [];
  }
}

function tweetTitle(text: string): string {
  const firstLine = text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? text;
  return firstLine.length <= 120 ? firstLine : `${firstLine.slice(0, 117).trimEnd()}...`;
}

function isoTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function failed(code: SourceFailure['code'], message: string, retryable: boolean) {
  return { status: 'failed' as const, failure: { code, message, retryable } };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
