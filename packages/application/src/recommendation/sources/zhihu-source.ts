/* Uses Zhihu API excerpts and isolated browser search/detail fallback. */
import { z } from 'zod';
import { boundedMaterial, identifyContentUrl, publicationClaim } from './source-material';
import { htmlToPlainText } from '../content/normalize-content';
import type { EmbeddedBrowser } from './browser-access';
import { budgetedSourceFetch, requestSourceJson, sourceFailure } from './source-http';
import { searchPlatformPage } from './platform-search';
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
  readonly browser?: EmbeddedBrowser;
}

/** Search applies an EditTime window; detail supplies separate creation evidence. */
const ZHIHU_DESCRIPTOR: SourceDescriptor = {
  id: 'zhihu',
  description: '中文问答与专栏文章。',
  accessPaths: ['credential', 'browser_session'],
  maxResultsPerSearch: MAX_RESULTS_PER_SEARCH,
  supportsTimeRange: true,
  material: 'excerpt',
  supportsFetch: true,
};

export function createZhihuSource(options: ZhihuSourceOptions): SourceConnector {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let apiCooldown: { until: number; failure: SourceFailure } | undefined;

  const primary: SourceConnector = {
    managesRequestBudget: true,
    id: 'zhihu',
    descriptor: ZHIHU_DESCRIPTOR,
    async search(request): Promise<SourceSearchResult> {
      if (apiCooldown && apiCooldown.until > now()) return { status: 'failed', failure: apiCooldown.failure };
      const accessSecret = options.accessSecret()?.trim();
      if (!accessSecret) {
        return failed('not_configured', 'Zhihu access secret is not configured.', false);
      }

      const url = new URL(SEARCH_URL);
      url.searchParams.set('Query', request.query.trim());
      url.searchParams.set('Count', String(clampLimit(request.limit)));
      const sortBy = editTimeFilter(request.timeRange);
      if (sortBy) url.searchParams.set('SortBy', sortBy);

      const response = await requestSourceJson(budgetedSourceFetch(fetchImplementation, request.reserveRequest, 'search'), url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessSecret}`,
          'X-Request-Timestamp': String(Math.floor(now() / 1_000)),
          'Content-Type': 'application/json',
        },
        signal: request.signal,
      }, ZhihuResponseSchema, 30_000, protectLargeContentIds);
      if (response.status === 'failed') {
        if (response.failure.retryAfterMs !== undefined) apiCooldown = { until: now() + response.failure.retryAfterMs, failure: response.failure };
        return response;
      }
      const envelope = response.payload;
      if (envelope.Code !== 0) {
        const result = codeFailure(envelope.Code, envelope.Message);
        if (result.status === 'failed' && result.failure.code === 'rate_limited') apiCooldown = { until: now() + 300_000, failure: { ...result.failure, retryAfterMs: 300_000 } };
        return result;
      }

      const items = envelope.Data?.Items;
      if (!items) return sourceFailure('invalid_response', 'Zhihu returned no result list.');
      return { status: 'success', items: items.flatMap((item) => toRawItem(item)) };
    },
    async fetch(request): Promise<SourceMaterialResult> {
      if (!options.browser) return sourceFailure('material_unavailable', 'Zhihu browser access is unavailable.');
      const identity = identifyContentUrl(request.url);
      if (!identity || identity.platform !== 'zhihu' || !identity.externalId) return sourceFailure('invalid_response', 'URL does not identify a Zhihu answer or article.');
      if (request.signal?.aborted) return sourceFailure('cancelled', 'Zhihu detail was cancelled.');
      if (request.reserveRequest && !request.reserveRequest('material')) return sourceFailure('budget_exhausted', 'Source request budget was exhausted.');
      const result = await options.browser.readPlatform({
        profileId: 'zhihu',
        operation: 'detail',
        url: identity.url,
        signal: request.signal ?? new AbortController().signal
      });
      if (result.status === 'failed') return sourceFailure(result.failure.code, result.failure.message);
      if (result.snapshot.pageState === 'login_required' || result.snapshot.pageState === 'challenge_required') return sourceFailure(result.snapshot.pageState, 'Zhihu requires user access verification.');
      const state = ZhihuPageSchema.safeParse(result.snapshot.structuredData);
      const entry = state.success ? (identity.url.includes('/answer/') ? state.data.answers : state.data.articles)[identity.externalId] : undefined;
      if (!entry && identifyContentUrl(result.snapshot.finalUrl)?.url !== identity.url) return sourceFailure('invalid_response', 'Zhihu redirected to another content.');
      const body = boundedMaterial(entry ? htmlToPlainText(entry.content) : result.snapshot.bodyText);
      if (!body.text) return sourceFailure('material_unavailable', 'Zhihu returned no detail text.');
      return {
        status: 'success', material: {
          ...body,
          truncated: body.truncated || (!entry && result.snapshot.truncated === true),
          kind: 'full_text',
          method: 'zhihu_browser_detail',
          platform: 'zhihu',
          title: entry?.title,
          author: entry?.author?.name,
          authorId: entry?.author?.id,
          publishedAt: entry?.createdTime === undefined ? undefined : entry?.createdTime * 1_000,
          publicationEvidence: [
            ...(entry?.createdTime === undefined ? [] : [publicationClaim(entry?.createdTime * 1_000, 'Zhihu.detail.createdTime', 'published', true)]),
            ...(entry?.updatedTime === undefined ? [] : [publicationClaim(entry?.updatedTime * 1_000, 'Zhihu.detail.updatedTime', 'modified')]),
          ],
        }
      };
    },
  };
  return {
    ...primary,
    async search(request) {
      const result = await primary.search(request);
      if (!options.browser || (result.status === 'success' && result.items.length > 0) || (result.status === 'failed' && ['cancelled', 'budget_exhausted'].includes(result.failure.code))) return result;
      return searchPlatformPage(options.browser, 'zhihu', request);
    },
  };
}

const ZhihuPageEntrySchema = z.object({
  content: z.string(),
  title: z.string().optional(),
  createdTime: z.number().nonnegative().optional(),
  updatedTime: z.number().nonnegative().optional(),
  author: z.object({ name: z.string().optional(), id: z.string().optional() }).optional(),
});
const ZhihuPageSchema = z.object({ answers: z.record(z.string(), ZhihuPageEntrySchema), articles: z.record(z.string(), ZhihuPageEntrySchema) });

/** Maps one platform entry, dropping entries that carry no usable link. */
function toRawItem(value: unknown): readonly RawItem[] {
  const parsed = ZhihuItemSchema.safeParse(value);
  if (!parsed.success) return [];
  const entry = parsed.data;
  const identity = entry.Url ? identifyContentUrl(entry.Url) : undefined;
  if (!identity || identity.platform !== 'zhihu') return [];

  const title = entry.Title?.trim();
  const text = entry.ContentText?.trim();
  const author = entry.AuthorName?.trim();
  return [
    {
      source: 'zhihu',
      ...identity,
      method: 'zhihu_api_search',
      serviceRecordId: String(entry.ContentID),
      kind: 'excerpt',
      truncated: false,
      rangeStart: 0,
      rangeEnd: [...(text ?? '')].length,
      publicationEvidence: entry.EditTime === undefined ? [] : [publicationClaim(entry.EditTime * 1_000, 'Zhihu.Items.EditTime', 'modified')],
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      ...(author ? { author } : {}),
    },
  ];
}

/** Restricts the search to an inclusive modification window; the platform expects seconds. */
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
