/*
 * Owns Zhihu Open Platform search, authentication, and SourceContent normalization.
 */
import {
  SourceContentSchema,
  type DiscoveryContentType,
  type DiscoverySource,
  type SourceFailure,
} from './discovery-source';

const SEARCH_URL = 'https://developer.zhihu.com/api/v1/content/zhihu_search';
const MAX_RESULTS = 10;

type FetchImplementation = typeof globalThis.fetch;

/** Creates the Zhihu Source backed by the user-configured Open Platform credential. */
export function createZhihuSource(input: {
  readonly accessSecret: () => string | undefined;
  readonly fetch?: FetchImplementation;
  readonly now?: () => number;
}): DiscoverySource {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const now = input.now ?? Date.now;
  let availability: ReturnType<DiscoverySource['getAvailability']> = { state: 'unknown' };

  return {
    descriptor: {
      id: 'zhihu',
      name: '知乎',
      access: 'configured_provider',
      supportedModes: ['relevance'],
      supportsRead: false,
    },
    getAvailability() {
      if (!input.accessSecret()?.trim()) return { state: 'not_configured' };
      return availability;
    },
    async search(request) {
      const accessSecret = input.accessSecret()?.trim();
      if (!accessSecret) return failed('not_configured', 'Zhihu search is not configured.', false);
      if (request.mode !== 'relevance') {
        return failed('invalid_response', 'Zhihu does not support recent search.', false);
      }
      try {
        const url = new URL(SEARCH_URL);
        url.searchParams.set('Query', request.query.trim());
        url.searchParams.set('Count', String(Math.min(MAX_RESULTS, Math.max(1, Math.floor(request.limit)))));
        const response = await fetchImplementation(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessSecret}`,
            'X-Request-Timestamp': String(Math.floor(now() / 1_000)),
            'Content-Type': 'application/json',
          },
          signal: request.signal,
        });
        if (response.status === 429) return providerFailure('rate_limited', 'Zhihu rate limited the request.', true);
        if (!response.ok) {
          return providerFailure('invalid_response', `Zhihu returned HTTP ${response.status}.`, response.status >= 500);
        }
        const items = normalizeResponse(await response.text());
        availability = { state: 'ready', checkedAt: new Date(now()).toISOString() };
        return { status: 'success', items };
      } catch (error) {
        if (request.signal.aborted) return failed('cancelled', 'Zhihu request was cancelled.', false);
        return failed('network_error', error instanceof Error ? error.message : 'Zhihu request failed.', true);
      }
    },
  };

  function providerFailure(code: SourceFailure['code'], message: string, retryable: boolean) {
    availability = code === 'rate_limited'
      ? { state: 'rate_limited', checkedAt: new Date(now()).toISOString() }
      : { state: 'unknown', checkedAt: new Date(now()).toISOString() };
    return failed(code, message, retryable);
  }
}

/** Normalizes either documented JSON or legacy XML responses at the provider boundary. */
function normalizeResponse(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // The Open Platform has returned XML payloads in addition to documented JSON.
    value = text;
  }
  const entries = typeof value === 'string'
    ? parseXmlEntries(value)
    : arrayValue(value, 'data') ?? arrayValue(value, 'results') ?? [];
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = stringValue(entry.url) ?? stringValue(entry.link);
    const title = plainText(stringValue(entry.title));
    if (!url || !title) return [];
    try {
      const canonicalUrl = new URL(url).toString();
      const description = plainText(stringValue(entry.content) ?? stringValue(entry.description) ?? stringValue(entry.excerpt));
      const publishedAt = isoTimestamp(stringValue(entry.edit_time) ?? stringValue(entry.published_at));
      const sourceContentId = zhihuContentId(canonicalUrl);
      return [SourceContentSchema.parse({
        sourceId: 'zhihu',
        sourceName: '知乎',
        ...(sourceContentId ? { sourceContentId } : {}),
        canonicalUrl,
        contentType: zhihuContentType(stringValue(entry.content_type), canonicalUrl),
        title,
        ...(stringValue(entry.author_name) ? { author: stringValue(entry.author_name) } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        ...(description ? { description } : {}),
      })];
    } catch {
      // One malformed provider entry must not discard the rest of the response.
      return [];
    }
  });
}

function parseXmlEntries(text: string): Record<string, unknown>[] {
  return [...text.matchAll(/<search_item\b([^>]*)>([\s\S]*?)<\/search_item>/giu)].map((match) => {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w_]+)="([^"]*)"/gu)].map((attribute) => [attribute[1], decodeXml(attribute[2])]),
    );
    return { ...attributes, content: decodeXml(match[2]) };
  });
}

function zhihuContentId(url: string): string | undefined {
  const path = new URL(url).pathname;
  const answer = path.match(/\/answer\/(\d+)/u)?.[1];
  if (answer) return `answer:${answer}`;
  const article = path.match(/\/p\/(\d+)/u)?.[1];
  if (article) return `article:${article}`;
  const question = path.match(/\/question\/(\d+)/u)?.[1];
  return question ? `question:${question}` : undefined;
}

function zhihuContentType(value: string | undefined, url: string): DiscoveryContentType {
  if (/\/p\/\d+/u.test(new URL(url).pathname)) return 'article';
  const normalized = value?.toLowerCase();
  return normalized === 'article' || normalized === 'answer' || normalized === 'question' ? 'article' : 'post';
}

function isoTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function failed(code: SourceFailure['code'], message: string, retryable: boolean) {
  return { status: 'failed' as const, failure: { code, message, retryable } };
}

function arrayValue(value: unknown, key: string): unknown[] | undefined {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function plainText(value: string | undefined): string | undefined {
  return value ? decodeXml(value.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim()) || undefined : undefined;
}

function decodeXml(value: string): string {
  return value.replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
