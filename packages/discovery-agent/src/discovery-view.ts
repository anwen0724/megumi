/* Defines stable renderer-facing views for discovery history and search. */
import { z } from 'zod';
import { DiscoveryFailureViewSchema, LocalDateSchema } from './daily-discovery/daily-discovery';
import { InterestCreatedFromSchema, InterestDescriptionSchema } from './interests/interest';
import { DiscoveryContentTypeSchema, DiscoverySourceIdSchema } from './sources/discovery-source';

const TimestampSchema = z.string().datetime({ offset: true });
const HttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Expected an HTTP(S) URL.');

export const DiscoveryHomeModeSchema = z.enum(['timeline', 'favorites', 'watch_later']);
export const InterestViewSchema = z.object({
  interestId: z.string().min(1),
  description: InterestDescriptionSchema,
  status: z.enum(['active', 'paused']),
  createdFrom: InterestCreatedFromSchema,
  userManagedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export const TodayDiscoveryViewSchema = z.object({
  localDate: LocalDateSchema,
  status: z.enum(['not_generated', 'running', 'published', 'failed']),
  batchId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  targetCount: z.number().int().min(1).max(100).optional(),
  resultCount: z.number().int().nonnegative(),
  failure: DiscoveryFailureViewSchema.optional(),
  publishedAt: TimestampSchema.optional(),
}).strict();

export const RecommendationViewSchema = z.object({
  recommendationId: z.string().min(1),
  batchId: z.string().min(1),
  localDate: LocalDateSchema,
  position: z.number().int().nonnegative(),
  sourceId: DiscoverySourceIdSchema,
  sourceName: z.string().trim().min(1),
  canonicalUrl: HttpUrlSchema,
  contentType: DiscoveryContentTypeSchema,
  sourceContentId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  contentPublishedAt: TimestampSchema.optional(),
  description: z.string().trim().min(1).optional(),
  coverUrl: HttpUrlSchema.optional(),
  recommendationReason: z.string().trim().min(1).max(1000),
  reaction: z.enum(['liked', 'disliked']).optional(),
  hidden: z.boolean(),
  favorite: z.boolean(),
  watchLater: z.boolean(),
  firstOpenedAt: TimestampSchema.optional(),
  lastOpenedAt: TimestampSchema.optional(),
  publishedAt: TimestampSchema,
}).strict();

export const DiscoveryDayViewSchema = z.object({
  localDate: LocalDateSchema,
  recommendations: z.array(RecommendationViewSchema),
}).strict();

export const DiscoveryHomeViewSchema = z.object({
  mode: DiscoveryHomeModeSchema,
  today: TodayDiscoveryViewSchema,
  days: z.array(DiscoveryDayViewSchema),
  interests: z.array(InterestViewSchema),
  favoriteCount: z.number().int().nonnegative(),
  watchLaterCount: z.number().int().nonnegative(),
  nextScheduledAt: TimestampSchema.optional(),
  nextCursor: z.string().min(1).optional(),
}).strict();

export const GetDiscoveryHomeRequestSchema = z.object({
  mode: DiscoveryHomeModeSchema,
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

export const SearchRecommendationsRequestSchema = z.object({
  query: z.string().trim().min(1).max(200),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

export const SearchRecommendationsResultSchema = z.object({
  query: z.string().trim().min(1).max(200),
  recommendations: z.array(RecommendationViewSchema),
  nextCursor: z.string().min(1).optional(),
}).strict();

export type DiscoveryHomeMode = z.infer<typeof DiscoveryHomeModeSchema>;
export type InterestView = z.infer<typeof InterestViewSchema>;
export type TodayDiscoveryView = z.infer<typeof TodayDiscoveryViewSchema>;
export type RecommendationView = z.infer<typeof RecommendationViewSchema>;
export type DiscoveryDayView = z.infer<typeof DiscoveryDayViewSchema>;
export type DiscoveryHomeView = z.infer<typeof DiscoveryHomeViewSchema>;
export type GetDiscoveryHomeRequest = z.infer<typeof GetDiscoveryHomeRequestSchema>;
export type SearchRecommendationsRequest = z.infer<typeof SearchRecommendationsRequestSchema>;
export type SearchRecommendationsResult = z.infer<typeof SearchRecommendationsResultSchema>;
