/*
 * Owns Zhihu Open Platform search, authentication, and SourceContent normalization.
 */
import {
  reportSourceProviderResponse,
  SourceContentSchema,
  type DiscoveryContentType,
  type DiscoverySource,
  type SourceFailure,
} from './discovery-source';
import type { Observability } from '@megumi/observability';

const SEARCH_URL = 'https://developer.zhihu.com/api/v1/content/zhihu_search';
const MAX_RESULTS = 10;

type FetchImplementation = typeof globalThis.fetch;

/** Creates the Zhihu Source backed by the user-configured Open Platform credential. */
export function createZhihuSource(input: {
  readonly accessSecret: () => string | undefined;
  readonly fetch?: FetchImplementation;
  readonly now?: () => number;
  readonly observability?: Observability;
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
      if (!input.accessSecret()?.trim()) {
        return { state: 'not_configured', ...(availability.checkedAt ? { checkedAt: availability.checkedAt } : {}) };
      }
      if (availability.state === 'not_configured') return { state: 'unknown', ...(availability.checkedAt ? { checkedAt: availability.checkedAt } : {}) };
      return availability;
    },
    async checkAvailability() {
      availability = {
        state: input.accessSecret()?.trim() ? 'ready' : 'not_configured',
        checkedAt: new Date(now()).toISOString(),
      };
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
        const responseText = await response.text();
        reportSourceProviderResponse(request.onProviderResponse, responseText);
        if (response.status === 429) return providerFailure('rate_limited', 'Zhihu rate limited the request.', true);
        if (!response.ok) {
          return providerFailure('invalid_response', `Zhihu returned HTTP ${response.status}.`, response.status >= 500);
        }
        let normalized: ReturnType<typeof normalizeResponse>;
        try {
          normalized = normalizeResponse(responseText);
        } catch {
          return providerFailure('invalid_response', 'Zhihu returned an unrecognized or unsuccessful response.', false);
        }
        try {
          input.observability?.recordContent({
            kind: 'source.normalization', correlation: { sourceId: 'zhihu' },
            value: { inputCount: normalized.inputCount, acceptedCount: normalized.items.length, rejected: normalized.rejected },
          });
        } catch {
          // Diagnostics must never turn a valid provider response into a failed search.
        }
        if (normalized.inputCount > 0 && normalized.items.length === 0) {
          return providerFailure('invalid_response', 'Zhihu returned entries, but none could be normalized.', false);
        }
        availability = { state: 'ready', checkedAt: new Date(now()).toISOString() };
        return { status: 'success', items: normalized.items.slice(0, Math.min(MAX_RESULTS, Math.max(1, Math.floor(request.limit)))) };
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

/** Validates the provider envelope and preserves per-entry rejection evidence. */
function normalizeResponse(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Keep the existing explicit XML entry format, but never accept arbitrary text as an empty response.
    value = text;
  }
  const official = isRecord(value) && ('Code' in value || 'Data' in value);
  let entries: unknown[] | undefined;
  if (isRecord(value) && official) {
    if (value.Code !== 0) throw new Error('Zhihu rejected the request.');
    entries = arrayValue(value.Data, 'Items');
  } else if (typeof value === 'string') {
    entries = parseXmlEntries(value);
    if (entries.length === 0) throw new Error('Unrecognized XML response.');
  } else {
    entries = arrayValue(value, 'data') ?? arrayValue(value, 'results');
  }
  if (!entries) throw new Error('Missing Zhihu result list.');
  const rejected: { index: number; reason: string }[] = [];
  const items = entries.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      rejected.push({ index, reason: 'entry_not_object' });
      return [];
    }
    const url = official ? stringValue(entry.Url) : stringValue(entry.url) ?? stringValue(entry.link);
    const title = plainText(stringValue(official ? entry.Title : entry.title));
    if (!url || !title) {
      rejected.push({ index, reason: 'missing_url_or_title' });
      return [];
    }
    try {
      const canonicalUrl = new URL(url).toString();
      const description = plainText(official ? stringValue(entry.ContentText) : stringValue(entry.content) ?? stringValue(entry.description) ?? stringValue(entry.excerpt));
      // EditTime is an update timestamp, not evidence of the original publication time.
      const publishedAt = official ? undefined : isoTimestamp(stringValue(entry.published_at));
      const author = stringValue(official ? entry.AuthorName : entry.author_name);
      const sourceContentId = zhihuContentId(canonicalUrl);
      return [SourceContentSchema.parse({
        sourceId: 'zhihu',
        sourceName: '知乎',
        ...(sourceContentId ? { sourceContentId } : {}),
        canonicalUrl,
        contentType: zhihuContentType(stringValue(official ? entry.ContentType : entry.content_type), canonicalUrl),
        title,
        ...(author ? { author } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        ...(description ? { description } : {}),
      })];
    } catch {
      rejected.push({ index, reason: 'invalid_content_fields' });
      return [];
    }
  });
  return { items, inputCount: entries.length, rejected };
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
