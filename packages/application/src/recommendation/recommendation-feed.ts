/* Projects recommendation feeds and applies reading, collection and reaction changes. */
import { z } from 'zod';
import type { Settings } from '../settings/settings-store';
import type { Candidates } from './collection/collect-candidates';
import type { Recommendations, TodayRecommendationResult } from './daily/generate-recommendations';
import type { Recommendation, UpdateRecommendationStateRequest } from './daily/publish-recommendations';
import { LocalDateSchema } from './daily/publish-recommendations';
import { InterestCreatedFromSchema, InterestDescriptionSchema } from './interests/interest-catalog';
import type { InterestRepository } from './interests/interest-storage';
import type { RecommendationRepository, UpdateRecommendationStateResult } from './recommendation-storage';
import { DiscoveryContentTypeSchema, DiscoverySourceIdSchema } from './sources/source-catalog';

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
  status: z.enum([
    'not_generated', 'waiting_for_candidates', 'model_unavailable',
    'running', 'published', 'failed', 'cancelled',
  ]),
  requestId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  resultCount: z.number().int().nonnegative(),
  failure: z.object({
    code: z.string().min(1), message: z.string(), retryable: z.boolean(),
  }).strict().optional(),
  publishedAt: TimestampSchema.optional(),
}).strict();

export const RecommendationViewSchema = z.object({
  recommendationId: z.string().min(1),
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
  contentSummary: z.string().trim().min(1).max(1000),
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
  candidateSupplyConfirmed: z.boolean(),
  candidateSupplyStatus: z.discriminatedUnion('status', [
    z.object({ status: z.literal('idle') }).strict(),
    z.object({ status: z.literal('running') }).strict(),
    z.object({
      status: z.literal('failed'), failure: z.object({
        code: z.string().min(1), message: z.string(), retryable: z.boolean(),
      }).strict()
    }).strict(),
  ]),
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

/** Reads paginated recommendation views and applies the user's reading and reaction changes. */
export function createRecommendationFeed(options: {
  readonly repository?: RecommendationRepository;
  readonly interests?: InterestRepository;
  readonly candidateSupply?: Pick<Candidates, 'getStatus'>;
  readonly settings?: Pick<Settings, 'readSettings'>;
  readonly recommendation?: Pick<Recommendations, 'getToday' | 'getNextScheduledAt'>;
  readonly notifyReactionChanged?: () => void;
}) {
  const { repository: recommendationRepository, candidateSupply, recommendation } = options;
  return {
    async getHome(rawRequest: GetDiscoveryHomeRequest) {
      if (!recommendationRepository) throw new Error('Recommendation is not configured.');
      const request = GetDiscoveryHomeRequestSchema.parse(rawRequest);
      const limit = request.limit ?? 20;
      const offset = decodeCursor(request.cursor);
      const page = recommendationRepository.listRecommendations({
        view: request.mode === 'timeline' ? 'history' : request.mode,
        includeHidden: false,
        offset,
        limit,
      });
      const days = new Map<string, RecommendationView[]>();
      for (const item of page.items) {
        const values = days.get(item.localDate) ?? [];
        values.push(recommendationView(item));
        days.set(item.localDate, values);
      }
      return DiscoveryHomeViewSchema.parse({
        candidateSupplyConfirmed: options.settings
          ? readConfiguration(options.settings).discovery.candidateSupplyConfirmed
          : false,
        candidateSupplyStatus: candidateSupply?.getStatus() ?? { status: 'idle' },
        mode: request.mode,
        today: todayView(recommendation?.getToday()),
        days: [...days].map(([localDate, recommendations]) => ({ localDate, recommendations })),
        // Project the home response explicitly; durable revision and lifecycle fields stay on the entity.
        interests:
          options.interests?.listNonDeletedInterests()
            .filter(({ status }) => status !== 'deleted')
            .map((interest) => ({
              interestId: interest.id,
              description: interest.description,
              status: interest.status,
              createdFrom: interest.createdFrom,
              ...(interest.userManagedAt ? { userManagedAt: interest.userManagedAt } : {}),
              createdAt: interest.createdAt,
              updatedAt: interest.updatedAt,
            })) ?? [],
        favoriteCount: recommendationRepository.countRecommendations('favorites'),
        watchLaterCount: recommendationRepository.countRecommendations('watch_later'),
        ...(recommendation?.getNextScheduledAt()
          ? { nextScheduledAt: recommendation.getNextScheduledAt() }
          : {}),
        ...(page.hasMore ? { nextCursor: encodeCursor(offset + limit) } : {}),
      });
    },
    async search(rawRequest: SearchRecommendationsRequest) {
      if (!recommendationRepository) throw new Error('Recommendation is not configured.');
      const request = SearchRecommendationsRequestSchema.parse(rawRequest);
      const limit = request.limit ?? 20;
      const offset = decodeCursor(request.cursor);
      const page = recommendationRepository.searchRecommendations({
        query: request.query,
        includeHidden: false,
        offset,
        limit,
      });
      return SearchRecommendationsResultSchema.parse({
        query: request.query,
        recommendations: page.items.map(recommendationView),
        ...(page.hasMore ? { nextCursor: encodeCursor(offset + limit) } : {}),
      });
    },
    async updateState(request: UpdateRecommendationStateRequest): Promise<UpdateRecommendationStateResult> {
      if (!recommendationRepository) return { status: 'not_found' };
      const result = recommendationRepository.updateState(request);
      if (request.action === 'set_reaction' && result.status === 'updated') {
        options.notifyReactionChanged?.();
      }
      return result;
    },
  };
}

function recommendationView(item: Recommendation): RecommendationView {
  return {
    recommendationId: item.id,
    localDate: item.localDate,
    position: item.position,
    sourceId: item.content.sourceId,
    sourceName: item.content.sourceName,
    canonicalUrl: item.content.canonicalUrl,
    contentType: item.content.contentType,
    ...(item.content.sourceContentId ? { sourceContentId: item.content.sourceContentId } : {}),
    title: item.content.title,
    ...(item.content.author ? { author: item.content.author } : {}),
    ...(item.content.contentPublishedAt
      ? { contentPublishedAt: item.content.contentPublishedAt }
      : {}),
    ...(item.content.description ? { description: item.content.description } : {}),
    contentSummary: item.content.contentSummary,
    ...(item.content.coverUrl ? { coverUrl: item.content.coverUrl } : {}),
    recommendationReason: item.recommendationReason,
    ...(item.state.reaction ? { reaction: item.state.reaction } : {}),
    hidden: item.state.hiddenAt !== undefined,
    favorite: item.state.favoriteAt !== undefined,
    watchLater: item.state.watchLaterAt !== undefined,
    ...(item.state.firstOpenedAt ? { firstOpenedAt: item.state.firstOpenedAt } : {}),
    ...(item.state.lastOpenedAt ? { lastOpenedAt: item.state.lastOpenedAt } : {}),
    publishedAt: item.publishedAt,
  };
}

function todayView(value: TodayRecommendationResult | undefined) {
  if (!value)
    return {
      localDate: new Date().toISOString().slice(0, 10),
      status: 'not_generated',
      resultCount: 0,
    };
  if (value.status === 'published')
    return {
      localDate: value.collection.localDate,
      status: 'published',
      resultCount: value.collection.items.length,
      publishedAt: value.collection.publishedAt,
    };
  return {
    localDate: value.localDate,
    status: value.status,
    resultCount: 0,
    ...('requestId' in value ? { requestId: value.requestId } : {}),
    ...('executionId' in value ? { executionId: value.executionId } : {}),
    ...('failure' in value ? { failure: value.failure } : {}),
  };
}

function encodeCursor(offset: number): string {
  return `offset:${offset}`;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/u.exec(cursor);
  if (!match) throw new Error('Recommendation cursor is invalid.');
  return Number(match[1]);
}

function readConfiguration(settings: Pick<Settings, 'readSettings'>) {
  const result = settings.readSettings();
  if (result.status === 'rejected') throw new Error(result.error.message);
  return result.settings.config;
}
