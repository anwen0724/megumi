/*
 * Defines persisted Recommendation snapshots, user-state commands, and conversation references.
 */
import { z } from 'zod';
import {
  RecommendationReferenceContentSchema,
  type RecommendationReferenceContent,
} from '@megumi/session';
import {
  DiscoveryContentTypeSchema,
  DiscoverySourceIdSchema,
} from '../sources/discovery-source';

const TimestampSchema = z.string().datetime({ offset: true });
const HttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Expected an HTTP(S) URL.');

export const RecommendationSchema = z.object({
  recommendationId: z.string().min(1),
  batchId: z.string().min(1),
  candidateId: z.string().min(1).optional(),
  contentIdentity: z.string().min(1),
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
  hiddenAt: TimestampSchema.optional(),
  favoriteAt: TimestampSchema.optional(),
  watchLaterAt: TimestampSchema.optional(),
  firstOpenedAt: TimestampSchema.optional(),
  lastOpenedAt: TimestampSchema.optional(),
  publishedAt: TimestampSchema,
  stateUpdatedAt: TimestampSchema.optional(),
}).strict();

export const UpdateRecommendationStateRequestSchema = z.discriminatedUnion('action', [
  z.object({ recommendationId: z.string().min(1), action: z.literal('opened') }).strict(),
  z.object({
    recommendationId: z.string().min(1),
    action: z.literal('set_reaction'),
    reaction: z.enum(['liked', 'disliked']).nullable(),
  }).strict(),
  z.object({
    recommendationId: z.string().min(1),
    action: z.literal('set_hidden'),
    hidden: z.boolean(),
  }).strict(),
  z.object({
    recommendationId: z.string().min(1),
    action: z.literal('set_favorite'),
    favorite: z.boolean(),
  }).strict(),
  z.object({
    recommendationId: z.string().min(1),
    action: z.literal('set_watch_later'),
    watchLater: z.boolean(),
  }).strict(),
]);

export { RecommendationReferenceContentSchema };

export type Recommendation = z.infer<typeof RecommendationSchema>;
export type UpdateRecommendationStateRequest = z.infer<typeof UpdateRecommendationStateRequestSchema>;
export type { RecommendationReferenceContent };
