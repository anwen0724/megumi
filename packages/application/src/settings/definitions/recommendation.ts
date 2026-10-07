/* Defines the target recommendation settings; production switches to this contract in P3. */
import { z } from 'zod';
import { ModelReferenceSchema } from './providers';

export const RecommendationLimitsSchema = z.object({
  maxSearchCalls: z.number().int().min(2).default(25),
  maxFetchCalls: z.number().int().nonnegative().default(20),
  maxSourceRequests: z.number().int().positive().default(80),
  maxPlanningCalls: z.number().int().nonnegative().default(4),
  maxAnalysisCalls: z.number().int().nonnegative().default(40),
  maxMatchingCalls: z.number().int().nonnegative().default(20),
  maxJudgmentCalls: z.number().int().nonnegative().default(10),
  maxSelectionCalls: z.number().int().nonnegative().default(10),
  maxModelInputTokens: z.number().int().positive().default(200_000),
  maxModelOutputTokens: z.number().int().positive().default(60_000),
  maxRequestInputTokens: z.number().int().positive().default(12_000),
  maxRequestOutputTokens: z.number().int().positive().default(2_000),
  maxDurationMinutes: z.number().positive().default(20),
  requestTimeoutSeconds: z.number().positive().default(30),
  maxConcurrentSourceRequests: z.number().int().positive().default(2),
  maxConcurrentModelRequests: z.number().int().positive().default(2),
}).strict().refine(limits=>limits.maxRequestInputTokens<=limits.maxModelInputTokens&&limits.maxRequestOutputTokens<=limits.maxModelOutputTokens,'Per-request tokens must not exceed the run budget.');

export const RecommendationConfigurationSchema = z.object({
  enabled: z.boolean().default(false),
  enabledSources: z.array(z.enum(['tavily', 'bing_rss', 'zhihu', 'bilibili', 'xiaohongshu'])).refine(
    (ids) => new Set(ids).size === ids.length,
    'Source IDs must be unique.'
  ).default(['tavily', 'bing_rss', 'zhihu', 'bilibili', 'xiaohongshu']),
  candidateSupplyModel: ModelReferenceSchema.optional(),
  recommendationModel: ModelReferenceSchema.optional(),
  dailyFeed: z.object({
    runAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00'),
    lookbackDays: z.number().int().min(1).max(7).default(3),
    historyDays: z.literal(7).default(7),
    maxItemsPerInterest: z.number().int().positive().default(10),
    maxItemsPerDay: z.number().int().positive().default(30)
  }).strict().refine(feed=>feed.maxItemsPerDay>=feed.maxItemsPerInterest,'Daily total must not be less than the per-interest limit.').default({}),
  candidateSupply: z.object({
    interestMinimumCount: z.number().int().nonnegative().default(10),
    interestTargetCount: z.number().int().positive().default(30),
    maintenanceIntervalMinutes: z.number().int().positive().default(60),
    maxSearchBackoffHours: z.number().int().positive().default(24),
    reviewAfterDays: z.number().int().positive().default(30),
    contentLanguages: z.array(z.string().trim().min(1)).default([]),
    searchReuseIntervalMinutes: z.number().int().positive().default(360),
    searchHistoryDays: z.number().int().positive().default(30)
  }).strict().refine(
    (supply) => supply.interestTargetCount > supply.interestMinimumCount,
    'Target count must exceed minimum count.'
  ).default({}),
  curated: z.object({
    targetCount: z.number().int().positive().default(10),
    maxCandidateCount: z.number().int().positive().default(120),
    shortlistCount: z.number().int().positive().default(30),
    maxItemsPerPublisher: z.number().int().positive().default(3),
    historyDays: z.number().int().positive().default(30)
  }).strict().refine(curated=>curated.targetCount<=curated.shortlistCount&&curated.shortlistCount<=curated.maxCandidateCount,'Target must not exceed shortlist, and shortlist must not exceed the input window.').default({}),
  limits: RecommendationLimitsSchema.default({}),
}).strict();
export type RecommendationConfiguration = z.infer<typeof RecommendationConfigurationSchema>;
