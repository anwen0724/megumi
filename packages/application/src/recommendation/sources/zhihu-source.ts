/*
 * Implements the Zhihu Open Platform source: authentication, search, and field
 * mapping. The platform returns content text but exposes full text only for the
 * credential owner's own posts, so `fetch` reports material unavailability
 * rather than scraping another page.
 */
import { z } from 'zod';
import type {
  RawItem,
  SourceConnector,
  SourceDescriptor,
  SourceFailure,
  SourceMaterialResult,
  SourceSearchResult,
} from './source-connector';

const SEARCH_URL = 'https://developer.zhihu.com/api/v1/content/zhihu_search';
/** The search endpoint truncates any Count above this value. */
const MAX_RESULTS_PER_SEARCH = 10;

const ZhihuItemSchema = z
  .object({
    Title: z.string().optional(),
    ContentType: z.string().optional(),
    ContentID: z.union([z.string(), z.number()]).optional(),
    ContentText: z.string().optional(),
    Url: z.string().optional(),
    AuthorName: z.string().optional(),
    EditTime: z.number().optional(),
  })
  .passthrough();

const ZhihuResponseSchema = z
  .object({
    Code: z.number(),
    Message: z.string().optional(),
    Data: z
      .object({
        HasMore: z.boolean().optional(),
        SearchHashId: z.string().optional(),
        Items: z.array(z.unknown()).optional(),
        EmptyReason: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface ZhihuSourceOptions {
  /** Reads the stored Access Secret at request time; never cached in a snapshot. */
  readonly accessSecret: () => string | undefined;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

/**
 * The Zhihu Open Platform capabilities. The search endpoint returns an excerpt
 * rather than full text, it filters by the same time it maps to `publishedAt`,
 * and the full-text endpoint only serves the credential owner's own posts, so
 * material cannot be completed on demand.
 */
const ZHIHU_DESCRIPTOR: SourceDescriptor = {
  id: 'zhihu',
  description: '中文问答与专栏文章。',
  maxResultsPerSearch: MAX_RESULTS_PER_SEARCH,
  supportsTimeRange: true,
  material: 'excerpt',
  supportsFetch: false,
};

export function createZhihuSource(options: ZhihuSourceOptions): SourceConnector {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;

  return {
    id: 'zhihu',
    descriptor: ZHIHU_DESCRIPTOR,

    async search(request): Promise<SourceSearchResult> {
      const accessSecret = options.accessSecret()?.trim();
      if (!accessSecret) {
        return failed('not_configured', 'Zhihu access secret is not configured.', false);
      }

      const url = new URL(SEARCH_URL);
      url.searchParams.set('Query', request.query.trim());
      url.searchParams.set('Count', String(clampLimit(request.limit)));
      const sortBy = editTimeFilter(request.timeRange);
      if (sortBy) url.searchParams.set('SortBy', sortBy);

      let response: Response;
      try {
        response = await fetchImplementation(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessSecret}`,
            'X-Request-Timestamp': String(Math.floor(now() / 1_000)),
            'Content-Type': 'application/json',
          },
          ...(request.signal ? { signal: request.signal } : {}),
        });
      } catch (error) {
        if (request.signal?.aborted) {
          return failed('cancelled', 'Zhihu search was cancelled.', false);
        }
        return failed('network_error', describeError(error), true);
      }

      if (!response.ok) return httpFailure(response.status);

      let parsed: unknown;
      try {
        parsed = JSON.parse(protectLargeContentIds(await response.text()));
      } catch {
        return failed('invalid_response', 'Zhihu returned a non-JSON response.', false);
      }

      const envelope = ZhihuResponseSchema.safeParse(parsed);
      if (!envelope.success) {
        return failed('invalid_response', 'Zhihu returned an unrecognized response.', false);
      }
      if (envelope.data.Code !== 0) return codeFailure(envelope.data.Code, envelope.data.Message);

      const items = envelope.data.Data?.Items ?? [];
      return { status: 'success', items: items.flatMap((item) => toRawItem(item)) };
    },

    async fetch(): Promise<SourceMaterialResult> {
      return {
        status: 'failed',
        failure: {
          code: 'material_unavailable',
          message:
            'Zhihu Open Platform exposes full text only for the credential owner\u2019s own posts.',
          retryable: false,
        },
      };
    },
  };
}

/** Maps one platform entry, dropping entries that carry no usable link. */
function toRawItem(value: unknown): readonly RawItem[] {
  const parsed = ZhihuItemSchema.safeParse(value);
  if (!parsed.success) return [];
  const entry = parsed.data;
  const url = entry.Url?.trim();
  if (!url) return [];

  const title = entry.Title?.trim();
  const text = entry.ContentText?.trim();
  const author = entry.AuthorName?.trim();
  const externalId = entry.ContentID === undefined ? undefined : String(entry.ContentID);
  return [
    {
      source: 'zhihu',
      url,
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      ...(author ? { author } : {}),
      ...(externalId ? { externalId } : {}),
      // EditTime is the platform's publication timestamp in seconds.
      ...(entry.EditTime !== undefined ? { publishedAt: entry.EditTime * 1_000 } : {}),
    },
  ];
}

/** Restricts the search to an inclusive publication window; the platform expects seconds. */
function editTimeFilter(timeRange?: { readonly from?: number; readonly to?: number }): string | undefined {
  if (!timeRange || (timeRange.from === undefined && timeRange.to === undefined)) return undefined;
  const from = timeRange.from === undefined ? '' : String(Math.floor(timeRange.from / 1_000));
  const to = timeRange.to === undefined ? '' : String(Math.floor(timeRange.to / 1_000));
  return `EditTime:desc:(${from},${to})`;
}

/**
 * Keeps `ContentID` text-exact. The platform sends int64 identifiers as JSON
 * numbers, and JavaScript would silently round anything beyond 2^53-1, so the
 * identifier becomes a string before parsing.
 */
function protectLargeContentIds(body: string): string {
  return body.replace(/("ContentID"\s*:\s*)(-?\d{16,})/gu, '$1"$2"');
}

function clampLimit(limit: number): number {
  return Math.min(MAX_RESULTS_PER_SEARCH, Math.max(1, Math.floor(limit)));
}

function httpFailure(status: number): SourceSearchResult {
  if (status === 401 || status === 403) {
    return failed('unauthorized', `Zhihu rejected the credential (HTTP ${status}).`, false);
  }
  if (status === 429) {
    return failed('rate_limited', 'Zhihu rate limited the request.', true);
  }
  return failed('unavailable', `Zhihu returned HTTP ${status}.`, status >= 500);
}

/** Maps platform business codes; only throttling is worth an in-round retry. */
function codeFailure(code: number, message?: string): SourceSearchResult {
  const detail = message?.trim() || `Zhihu error code ${code}.`;
  if (code === 20001) return failed('unauthorized', detail, false);
  if (code === 30001) return failed('rate_limited', detail, true);
  return failed('invalid_response', detail, false);
}

function failed(code: SourceFailure['code'], message: string, retryable: boolean): SourceSearchResult {
  return { status: 'failed', failure: { code, message, retryable } };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Zhihu search failed.';
}
