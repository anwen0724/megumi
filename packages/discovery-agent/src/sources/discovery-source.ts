/* Defines the extensible content-source boundary used by daily discovery. */
import { z } from 'zod';

const HttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Expected an HTTP(S) URL.');
const TimestampSchema = z.string().datetime({ offset: true });

export const DiscoverySourceIdSchema = z.string().trim().min(1);
export const SourceSearchModeSchema = z.enum(['relevance', 'recent']);
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
  supportedModes: z.array(SourceSearchModeSchema).min(1),
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
export type DiscoveryContentType = z.infer<typeof DiscoveryContentTypeSchema>;
export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;
export type SourceEngagement = z.infer<typeof SourceEngagementSchema>;
export type SourceContent = z.infer<typeof SourceContentSchema>;
export type SourceContentDetail = z.infer<typeof SourceContentDetailSchema>;
export type SourceFailure = z.infer<typeof SourceFailureSchema>;

export type SourceSearchResult =
  | { readonly status: 'success'; readonly items: readonly SourceContent[] }
  | { readonly status: 'failed'; readonly failure: SourceFailure };

export type SourceReadResult =
  | { readonly status: 'success'; readonly detail: SourceContentDetail }
  | { readonly status: 'failed'; readonly failure: SourceFailure };

export interface DiscoverySource {
  readonly descriptor: SourceDescriptor;
  search(request: {
    readonly query: string;
    readonly mode: SourceSearchMode;
    readonly limit: number;
    readonly signal: AbortSignal;
  }): Promise<SourceSearchResult>;
  read?(request: {
    readonly sourceContentId?: string;
    readonly url: string;
    readonly signal: AbortSignal;
  }): Promise<SourceReadResult>;
}
