/* Defines renderer-safe Discovery DTOs and strict Host request/response schemas. */
import { z } from 'zod';
import type {
  CandidateSupplyFacts,
  DailyRecommendationFacts,
  PreferenceLearningFacts,
  ReadDiscoveryFactsResult,
} from '@megumi/context';
import {
  DiscoveryHomeViewSchema,
  DiscoveryConfigurationViewSchema,
  DiscoverySourceViewSchema,
  ConnectDiscoverySourceRequestSchema,
  RefreshDiscoverySourceRequestSchema,
  EnsureDailyRecommendationRequestSchema,
  DailyRecommendationBatchSchema,
  GetDiscoveryHomeRequestSchema,
  InterestSchema,
  InterestUnderstandingSchema,
  CandidateSupplyCheckSchema,
  PreferenceLearningBatchSchema,
  PreferenceLearningCompletionSchema,
  RecommendationFeedbackChangeReceiptSchema,
  RecommendationViewSchema,
  SearchRecommendationsRequestSchema,
  SearchRecommendationsResultSchema,
  SessionParticipationSchema,
  UpdateRecommendationStateRequestSchema,
  UpdateDiscoveryConfigurationRequestSchema,
} from '@megumi/discovery';

export const DiscoveryInterestChangePayloadSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), description: z.string().trim().min(1).max(1_000) }).strict(),
  z.object({ action: z.literal('update'), interestId: z.string().min(1), description: z.string().trim().min(1).max(1_000) }).strict(),
  z.object({ action: z.literal('pause'), interestId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('resume'), interestId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('delete'), interestId: z.string().min(1) }).strict(),
]);
export const DiscoverySessionParticipationPayloadSchema = z.object({
  sessionId: z.string().min(1),
  participation: z.enum(['included', 'excluded']),
}).strict();
export const DiscoveryDailyEnsurePayloadSchema = EnsureDailyRecommendationRequestSchema;
export const DiscoveryHomePayloadSchema = GetDiscoveryHomeRequestSchema;
export const DiscoveryRecommendationSearchPayloadSchema = SearchRecommendationsRequestSchema;
export const DiscoveryRecommendationStatePayloadSchema = UpdateRecommendationStateRequestSchema;
export const DiscoveryInterestUnderstandingQuerySchema = z.union([
  z.object({ interestUnderstandingId: z.string().min(1) }).strict(),
  z.object({ executionId: z.string().min(1) }).strict(),
]);
export const DiscoveryCandidateSupplyRequestSchema = z.object({
  trigger: z.literal('evaluation').default('evaluation'),
}).strict();
export const DiscoveryDailyBatchQuerySchema = z.object({ localDate: z.string().date() }).strict();
export const DiscoveryCandidateSupplyQuerySchema = z.object({
  candidateSupplyCheckId: z.string().min(1),
}).strict();
export const DiscoveryPreferenceLearningQuerySchema = z.object({
  feedbackChangeId: z.string().min(1),
}).strict();
export const DiscoveryCandidateSupplyFactsQuerySchema = z.object({ executionId: z.string().min(1) }).strict();
export const DiscoveryDailyRecommendationFactsQuerySchema = z.object({
  executionId: z.string().min(1),
  batchId: z.string().min(1),
  localDate: z.string().date(),
}).strict();
export const DiscoveryPreferenceLearningFactsQuerySchema = z.object({ batchId: z.string().min(1) }).strict();
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));
export const DiscoveryFactsResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), facts: JsonValueSchema }).strict(),
  z.object({
    status: z.literal('failed'),
    failure: z.object({ code: z.string().min(1), message: z.string() }).strict(),
  }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
]);
export const DiscoveryBackgroundWaitOptionsSchema = z.object({
  timeoutMs: z.number().int().min(1).max(300_000).default(120_000),
}).strict();
export const DiscoveryConfigurationGetPayloadSchema = z.object({}).strict();
export const DiscoverySourcesRefreshPayloadSchema = z.object({}).strict();
export const DiscoveryConfigurationUpdatePayloadSchema = UpdateDiscoveryConfigurationRequestSchema;
export const DiscoverySourceConnectPayloadSchema = ConnectDiscoverySourceRequestSchema;
export const DiscoverySourceRefreshPayloadSchema = RefreshDiscoverySourceRequestSchema;
export const DiscoveryConfigurationUiDtoSchema = DiscoveryConfigurationViewSchema;
export const DiscoverySourceUiDtoSchema = DiscoverySourceViewSchema;

export const DiscoveryInterestUiDtoSchema = InterestSchema;
export const DiscoverySessionParticipationUiDtoSchema = SessionParticipationSchema;
export const DiscoveryDailyEnsureResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('started'), localDate: z.string(), batchId: z.string().min(1),
    executionId: z.string().min(1), requestedCount: z.number().int().positive(),
    actualTarget: z.number().int().positive(),
  }).strict(),
  z.object({ status: z.literal('in_progress'), localDate: z.string(), batchId: z.string().min(1), executionId: z.string().min(1) }).strict(),
  z.object({ status: z.literal('already_published'), localDate: z.string(), batchId: z.string().min(1), resultCount: z.number().int().nonnegative(), publishedAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({
    status: z.literal('waiting_for_candidates'), localDate: z.string(),
    requestedCount: z.number().int().positive(),
  }).strict(),
  z.object({ status: z.literal('model_unavailable'), localDate: z.string() }).strict(),
  z.object({
    status: z.literal('failed'), localDate: z.string(),
    failure: z.object({ code: z.string().min(1), message: z.string(), retryable: z.boolean() }).strict(),
  }).strict(),
]);
export const DiscoveryHomeUiResultSchema = DiscoveryHomeViewSchema;
export const DiscoveryRecommendationSearchUiResultSchema = SearchRecommendationsResultSchema;
export const DiscoveryRecommendationUiDtoSchema = RecommendationViewSchema;
export const DiscoveryRecommendationStateResultSchema = z.object({
  recommendation: RecommendationViewSchema,
  feedbackChange: RecommendationFeedbackChangeReceiptSchema.optional(),
}).strict();
export const DiscoveryInterestUnderstandingResultSchema = InterestUnderstandingSchema.nullable();
export const DiscoveryCandidateSupplyResultSchema = CandidateSupplyCheckSchema.nullable();
export const DiscoveryDailyBatchResultSchema = DailyRecommendationBatchSchema.nullable();
export const DiscoveryPreferenceLearningResultSchema = PreferenceLearningCompletionSchema.nullable();
export const DiscoveryPreferenceLearningBatchResultSchema = PreferenceLearningBatchSchema.nullable();

export type DiscoveryInterestChangePayload = z.infer<typeof DiscoveryInterestChangePayloadSchema>;
export type DiscoverySessionParticipationPayload = z.infer<typeof DiscoverySessionParticipationPayloadSchema>;
export type DiscoveryDailyEnsurePayload = z.infer<typeof DiscoveryDailyEnsurePayloadSchema>;
export type DiscoveryHomePayload = z.infer<typeof DiscoveryHomePayloadSchema>;
export type DiscoveryRecommendationSearchPayload = z.infer<typeof DiscoveryRecommendationSearchPayloadSchema>;
export type DiscoveryRecommendationStatePayload = z.infer<typeof DiscoveryRecommendationStatePayloadSchema>;
export type DiscoveryInterestUnderstandingQuery = z.infer<typeof DiscoveryInterestUnderstandingQuerySchema>;
export type DiscoveryCandidateSupplyRequest = z.infer<typeof DiscoveryCandidateSupplyRequestSchema>;
export type DiscoveryCandidateSupplyQuery = z.infer<typeof DiscoveryCandidateSupplyQuerySchema>;
export type DiscoveryPreferenceLearningQuery = z.infer<typeof DiscoveryPreferenceLearningQuerySchema>;
export type DiscoveryBackgroundWaitOptions = z.infer<typeof DiscoveryBackgroundWaitOptionsSchema>;
export type DiscoveryConfigurationGetPayload = z.infer<typeof DiscoveryConfigurationGetPayloadSchema>;
export type DiscoverySourcesRefreshPayload = z.infer<typeof DiscoverySourcesRefreshPayloadSchema>;
export type DiscoveryConfigurationUpdatePayload = z.infer<typeof DiscoveryConfigurationUpdatePayloadSchema>;
export type DiscoverySourceConnectPayload = z.infer<typeof DiscoverySourceConnectPayloadSchema>;
export type DiscoverySourceRefreshPayload = z.infer<typeof DiscoverySourceRefreshPayloadSchema>;
export type DiscoveryConfigurationUiDto = z.infer<typeof DiscoveryConfigurationUiDtoSchema>;
export type DiscoverySourceUiDto = z.infer<typeof DiscoverySourceUiDtoSchema>;
export type DiscoveryInterestUiDto = z.infer<typeof DiscoveryInterestUiDtoSchema>;
export type DiscoverySessionParticipationUiDto = z.infer<typeof DiscoverySessionParticipationUiDtoSchema>;
export type DiscoveryDailyEnsureResult = z.infer<typeof DiscoveryDailyEnsureResultSchema>;
export type DiscoveryHomeUiResult = z.infer<typeof DiscoveryHomeUiResultSchema>;
export type DiscoveryRecommendationSearchUiResult = z.infer<typeof DiscoveryRecommendationSearchUiResultSchema>;
export type DiscoveryRecommendationUiDto = z.infer<typeof DiscoveryRecommendationUiDtoSchema>;
export type DiscoveryRecommendationStateResult = z.infer<typeof DiscoveryRecommendationStateResultSchema>;
export type DiscoveryInterestUnderstandingResult = z.infer<typeof DiscoveryInterestUnderstandingResultSchema>;
export type DiscoveryCandidateSupplyResult = z.infer<typeof DiscoveryCandidateSupplyResultSchema>;
export type DiscoveryDailyBatchResult = z.infer<typeof DiscoveryDailyBatchResultSchema>;
export type DiscoveryPreferenceLearningResult = z.infer<typeof DiscoveryPreferenceLearningResultSchema>;
export type DiscoveryPreferenceLearningBatchResult = z.infer<typeof DiscoveryPreferenceLearningBatchResultSchema>;
export type DiscoveryCandidateSupplyFactsResult = ReadDiscoveryFactsResult<CandidateSupplyFacts>;
export type DiscoveryDailyRecommendationFactsResult = ReadDiscoveryFactsResult<DailyRecommendationFacts>;
export type DiscoveryPreferenceLearningFactsResult = ReadDiscoveryFactsResult<PreferenceLearningFacts>;

export type DiscoveryBackgroundWaitResult<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'timed_out' };

export interface DiscoveryHost {
  getConfiguration(request?: DiscoveryConfigurationGetPayload): Promise<DiscoveryConfigurationUiDto>;
  updateConfiguration(request: DiscoveryConfigurationUpdatePayload): Promise<DiscoveryConfigurationUiDto>;
  connectSource(request: DiscoverySourceConnectPayload): Promise<DiscoverySourceUiDto>;
  refreshSource(request: DiscoverySourceRefreshPayload): Promise<DiscoverySourceUiDto>;
  refreshSources(request?: DiscoverySourcesRefreshPayload): Promise<DiscoveryConfigurationUiDto>;
  changeInterest(request: DiscoveryInterestChangePayload): Promise<DiscoveryInterestUiDto>;
  setSessionParticipation(request: DiscoverySessionParticipationPayload): Promise<DiscoverySessionParticipationUiDto>;
  ensureDaily(request: DiscoveryDailyEnsurePayload): Promise<DiscoveryDailyEnsureResult>;
  getDailyBatch(request: z.infer<typeof DiscoveryDailyBatchQuerySchema>): Promise<DiscoveryDailyBatchResult>;
  waitDailyBatch(
    request: z.infer<typeof DiscoveryDailyBatchQuerySchema> & DiscoveryBackgroundWaitOptions,
  ): Promise<DiscoveryBackgroundWaitResult<NonNullable<DiscoveryDailyBatchResult>>>;
  getHome(request: DiscoveryHomePayload): Promise<DiscoveryHomeUiResult>;
  searchRecommendations(request: DiscoveryRecommendationSearchPayload): Promise<DiscoveryRecommendationSearchUiResult>;
  updateRecommendationState(request: DiscoveryRecommendationStatePayload): Promise<DiscoveryRecommendationStateResult>;
  getInterestUnderstanding(request: DiscoveryInterestUnderstandingQuery): Promise<DiscoveryInterestUnderstandingResult>;
  waitInterestUnderstanding(
    request: DiscoveryInterestUnderstandingQuery & DiscoveryBackgroundWaitOptions,
  ): Promise<DiscoveryBackgroundWaitResult<NonNullable<DiscoveryInterestUnderstandingResult>>>;
  requestCandidateSupply(request?: DiscoveryCandidateSupplyRequest): Promise<DiscoveryCandidateSupplyResult>;
  getCandidateSupplyCheck(request: DiscoveryCandidateSupplyQuery): Promise<DiscoveryCandidateSupplyResult>;
  waitCandidateSupplyCheck(
    request: DiscoveryCandidateSupplyQuery & DiscoveryBackgroundWaitOptions,
  ): Promise<DiscoveryBackgroundWaitResult<NonNullable<DiscoveryCandidateSupplyResult>>>;
  getCandidateSupplyFacts(
    request: z.infer<typeof DiscoveryCandidateSupplyFactsQuerySchema>,
  ): Promise<DiscoveryCandidateSupplyFactsResult>;
  getDailyRecommendationFacts(
    request: z.infer<typeof DiscoveryDailyRecommendationFactsQuerySchema>,
  ): Promise<DiscoveryDailyRecommendationFactsResult>;
  getPreferenceLearningBatch(batchId: string): Promise<DiscoveryPreferenceLearningBatchResult>;
  getPreferenceLearning(request: DiscoveryPreferenceLearningQuery): Promise<DiscoveryPreferenceLearningResult>;
  getPreferenceLearningFacts(
    request: z.infer<typeof DiscoveryPreferenceLearningFactsQuerySchema>,
  ): Promise<DiscoveryPreferenceLearningFactsResult>;
  waitPreferenceLearning(
    request: DiscoveryPreferenceLearningQuery & DiscoveryBackgroundWaitOptions,
  ): Promise<DiscoveryBackgroundWaitResult<NonNullable<DiscoveryPreferenceLearningResult>>>;
}
