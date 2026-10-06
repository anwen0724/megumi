/* Owns the source catalog responsibility of the Recommendation product. */
import type { WebFetch, WebSearch } from '@megumi/agent';
import { createBingRssWebSearch, createFallbackWebSearch } from '@megumi/agent';
import { z } from 'zod';
import type { Observability, OperationCompletion } from '../../observability/index';
import { createBilibiliSource } from './bilibili-source';
import type { EmbeddedBrowser } from './browser-access';
import { createDouyinSource } from './douyin-source';
import { createTwitterSource } from './twitter-source';
import { createOpenWebSource } from './web-source';
import { createXiaohongshuSource } from './xiaohongshu-source';
import { createZhihuSource } from './zhihu-source';

export const DISCOVERY_SOURCE_IDS = [
  'bilibili', 'open_web', 'xiaohongshu', 'douyin', 'zhihu', 'twitter',
] as const;

/** Creates Megumi's production Source catalog and returns its validated registry. */
export function createDiscoverySourceRegistry(input: {
  readonly webSearch?: WebSearch | (() => WebSearch | undefined);
  readonly webFetch?: WebFetch;
  readonly embeddedBrowser: EmbeddedBrowser;
  readonly zhihuAccessSecret?: () => string | undefined;
  readonly twitterApiKey?: () => string | undefined;
  readonly observability?: Observability;
  readonly onCheckError?: (error: unknown, sourceId: string) => void;
  readonly onCheckResult?: (sourceId: string, availability: SourceAvailability) => void;
}) {
  const configuredWebSearch = deferredWebSearch(input.webSearch);
  const bingWebSearch = createBingRssWebSearch();
  return createSourceRegistry([
    createBilibiliSource(),
    createOpenWebSource({
      webSearch: createFallbackWebSearch([configuredWebSearch, bingWebSearch]),
      webFetch: input.webFetch,
      provider: () => resolveWebSearch(input.webSearch) ? undefined : 'Bing',
    }),
    createXiaohongshuSource({ browser: input.embeddedBrowser }),
    createDouyinSource({ browser: input.embeddedBrowser }),
    createZhihuSource({ accessSecret: input.zhihuAccessSecret ?? (() => undefined), observability: input.observability }),
    createTwitterSource({ apiKey: input.twitterApiKey ?? (() => undefined) }),
  ], {
    observability: input.observability,
    ...(input.onCheckError ? { onCheckError: input.onCheckError } : {}),
    ...(input.onCheckResult ? { onCheckResult: input.onCheckResult } : {}),
  });
}

/** Resolves mutable Host settings for every request without weakening the fallback chain. */
function deferredWebSearch(input: WebSearch | (() => WebSearch | undefined) | undefined): WebSearch {
  return {
    async search(request) {
      const configured = resolveWebSearch(input);
      return configured
        ? configured.search(request)
        : { query: request.query.trim(), results: [] };
    },
  };
}

function resolveWebSearch(input: WebSearch | (() => WebSearch | undefined) | undefined): WebSearch | undefined {
  return typeof input === 'function' ? input() : input;
}

export interface SourceRegistry {
  /** Lists validated descriptors in registration order. */
  listDescriptors(): readonly SourceDescriptor[];
  /** Lists descriptors with their current availability snapshots. */
  listSources(): readonly { readonly descriptor: SourceDescriptor; readonly availability: SourceAvailability; }[];
  /** Returns a registered Source without imposing a search mode. */
  get(sourceId: DiscoverySourceId): DiscoverySource | undefined;
  /** Rechecks selected Sources and returns their latest availability snapshots. */
  checkSources(sourceIds: readonly DiscoverySourceId[], observability?: Observability): Promise<readonly {
    readonly descriptor: SourceDescriptor;
    readonly availability: SourceAvailability;
  }[]>;
  /** Resolves a registered Source and validates support for the requested mode. */
  resolve(sourceId: DiscoverySourceId, mode: SourceSearchMode): DiscoverySource;
}

/** Creates the validated registry used to resolve all configured Discovery Sources. */
export function createSourceRegistry(
  sources: readonly DiscoverySource[],
  options: {
    readonly observability?: Observability;
    readonly onCheckError?: (error: unknown, sourceId: string) => void;
    readonly onCheckResult?: (sourceId: string, availability: SourceAvailability) => void;
  } = {},
): SourceRegistry {
  const entries = new Map<DiscoverySourceId, { source: DiscoverySource; descriptor: SourceDescriptor; }>();
  for (const source of sources) {
    const sourceId = source.descriptor.id.trim();
    if (!sourceId) throw new Error('Source id must not be empty.');
    const parsed = SourceDescriptorSchema.safeParse({ ...source.descriptor, id: sourceId });
    if (!parsed.success) throw new Error(`Invalid source descriptor for source id ${sourceId}.`);
    if (entries.has(sourceId)) throw new Error(`Duplicate source id: ${sourceId}.`);
    entries.set(sourceId, { source, descriptor: parsed.data });
  }

  return {
    listDescriptors: () => [...entries.values()].map((entry) => entry.descriptor),
    listSources: () => [...entries.values()].map((entry) => ({
      descriptor: entry.descriptor,
      availability: entry.source.getAvailability(),
    })),
    get: (sourceId) => entries.get(sourceId.trim())?.source,
    async checkSources(sourceIds, observability) {
      const selected = new Set(sourceIds.map((sourceId) => sourceId.trim()));
      const targets = [...entries.values()].filter((entry) => selected.has(entry.descriptor.id));
      await Promise.all(targets.map(async (entry) => {
        try {
          const availability = await observeAvailability(observability ?? options.observability, entry.descriptor.id, async () => {
            await entry.source.checkAvailability?.();
            return entry.source.getAvailability();
          });
          try {
            options.onCheckResult?.(entry.descriptor.id, availability);
          } catch {
            // A successful check with an unavailable state is still a diagnostic fact, not a thrown operation.
          }
        } catch (error) {
          reportCheckError(options.onCheckError, error, entry.descriptor.id);
        }
      }));
      return targets.map((entry) => ({
        descriptor: entry.descriptor,
        availability: entry.source.getAvailability(),
      }));
    },
    resolve(sourceId, mode) {
      const entry = entries.get(sourceId.trim());
      if (!entry) throw new Error(`Unknown source: ${sourceId}.`);
      if (!entry.descriptor.supportedModes.includes(mode)) {
        throw new Error(`Source ${sourceId} does not support search mode ${mode}.`);
      }
      return entry.source;
    },
  };
}

/** Reports one Adapter failure without allowing it to cancel independent Source checks. */
function reportCheckError(
  reporter: ((error: unknown, sourceId: string) => void) | undefined,
  error: unknown,
  sourceId: string,
): void {
  try {
    reporter?.(error, sourceId);
  } catch {
    // A diagnostic callback cannot change Source availability or refresh completion.
  }
}

async function observeAvailability(
  observability: Observability | undefined,
  sourceId: string,
  operation: () => Promise<SourceAvailability>,
): Promise<SourceAvailability> {
  let operationPromise: Promise<SourceAvailability> | undefined;
  const runOnce = () => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name: 'source.availability.check',
      correlation: { sourceId },
      classifyResult: classifyAvailability,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyAvailability(availability: SourceAvailability): OperationCompletion {
  if (availability.state === 'ready') return { outcome: { status: 'ok', code: 'ready' } };
  return {
    outcome: {
      status: 'error',
      code: availability.state,
      message: `Source availability is ${availability.state}.`,
      retryable: availability.state !== 'not_configured',
    },
  };
}

const HttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Expected an HTTP(S) URL.');

const TimestampSchema = z.string().datetime({ offset: true });

export const DiscoverySourceIdSchema = z.string().trim().min(1);

export const SourceSearchModeSchema = z.enum(['relevance', 'recent']);

export const SourceAccessKindSchema = z.enum([
  'public_http',
  'configured_provider',
  'browser_session',
]);

export const SourceConnectionStateSchema = z.enum([
  'ready',
  'unknown',
  'not_configured',
  'login_required',
  'rate_limited',
  'risk_controlled',
]);

export const DiscoveryContentTypeSchema = z.enum([
  'video',
  'article',
  'news',
  'project',
  'post',
  'page',
  'other',
]);

export const SourceDescriptorSchema = z.object({
  id: DiscoverySourceIdSchema,
  name: z.string().trim().min(1),
  access: SourceAccessKindSchema,
  supportedModes: z.array(SourceSearchModeSchema).min(1),
  supportsRead: z.boolean(),
}).strict();

export const SourceAvailabilitySchema = z.object({
  state: SourceConnectionStateSchema,
  provider: z.string().trim().min(1).optional(),
  checkedAt: TimestampSchema.optional(),
  retryAt: TimestampSchema.optional(),
}).strict();

export const SourceEngagementSchema = z.object({
  viewCount: z.number().int().nonnegative().optional(),
  likeCount: z.number().int().nonnegative().optional(),
  commentCount: z.number().int().nonnegative().optional(),
  favoriteCount: z.number().int().nonnegative().optional(),
}).strict();

export const SourceContentSchema = z.object({
  sourceId: DiscoverySourceIdSchema,
  sourceName: z.string().trim().min(1),
  sourceContentId: z.string().trim().min(1).optional(),
  canonicalUrl: HttpUrlSchema,
  contentType: DiscoveryContentTypeSchema,
  title: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  publishedAt: TimestampSchema.optional(),
  description: z.string().trim().min(1).optional(),
  coverUrl: HttpUrlSchema.optional(),
  engagement: SourceEngagementSchema.optional(),
}).strict();

export const SourceContentDetailSchema = SourceContentSchema.extend({
  contentText: z.string().trim().min(1).optional(),
}).strict();

export const SourceFailureSchema = z.object({
  code: z.enum([
    'not_configured',
    'login_required',
    'rate_limited',
    'risk_control',
    'timeout',
    'network_error',
    'invalid_response',
    'cancelled',
  ]),
  message: z.string(),
  retryable: z.boolean(),
}).strict();

export type DiscoverySourceId = z.infer<typeof DiscoverySourceIdSchema>;

export type SourceSearchMode = z.infer<typeof SourceSearchModeSchema>;

export type SourceAccessKind = z.infer<typeof SourceAccessKindSchema>;

export type SourceConnectionState = z.infer<typeof SourceConnectionStateSchema>;

export type SourceAvailability = z.infer<typeof SourceAvailabilitySchema>;

export type DiscoveryContentType = z.infer<typeof DiscoveryContentTypeSchema>;

export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;

export type SourceEngagement = z.infer<typeof SourceEngagementSchema>;

export type SourceContent = z.infer<typeof SourceContentSchema>;

export type SourceContentDetail = z.infer<typeof SourceContentDetailSchema>;

export type SourceFailure = z.infer<typeof SourceFailureSchema>;

export type SourceSearchResult =
  | { readonly status: 'success'; readonly items: readonly SourceContent[]; }
  | { readonly status: 'failed'; readonly failure: SourceFailure; };

export type SourceReadResult =
  | { readonly status: 'success'; readonly detail: SourceContentDetail; }
  | { readonly status: 'failed'; readonly failure: SourceFailure; };

export interface DiscoverySource {
  readonly descriptor: SourceDescriptor;
  /** Reports current connection or provider availability without initiating work. */
  getAvailability(): SourceAvailability;
  /** Rechecks the Source's current availability and records the result. */
  checkAvailability?(): Promise<SourceAvailability>;
  /** Opens an interactive login flow when the Source requires a browser session. */
  connect?(): Promise<void>;
  /** Searches the Source and returns normalized, boundary-validated content. */
  search(request: {
    readonly query: string;
    readonly mode: SourceSearchMode;
    readonly limit: number;
    readonly signal: AbortSignal;
    /** Reports the raw upstream payload before Source normalization. */
    readonly onProviderResponse?: (response: unknown) => void;
  }): Promise<SourceSearchResult>;
  /** Reads normalized detail content when the Source supports detail retrieval. */
  read?(request: {
    readonly sourceContentId?: string;
    readonly url: string;
    readonly signal: AbortSignal;
    /** Reports the raw upstream payload before Source normalization. */
    readonly onProviderResponse?: (response: unknown) => void;
  }): Promise<SourceReadResult>;
}

/** Reports one raw Source payload without allowing diagnostics to alter Source behavior. */
export function reportSourceProviderResponse(
  observer: ((response: unknown) => void) | undefined,
  response: unknown,
): void {
  try {
    observer?.(response);
  } catch {
    // The upstream response remains authoritative when diagnostics are unavailable.
  }
}
