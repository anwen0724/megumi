/* Defines renderer-safe Discovery DTOs and strict Host request/response schemas. */
import { z } from 'zod';
import {
  DiscoveryHomeViewSchema,
  DiscoveryConfigurationViewSchema,
  DiscoverySourceViewSchema,
  ConnectDiscoverySourceRequestSchema,
  RefreshDiscoverySourceRequestSchema,
  EnsureDailyRecommendationRequestSchema,
  GetDiscoveryHomeRequestSchema,
  InterestSchema,
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

export type DiscoveryInterestChangePayload = z.infer<typeof DiscoveryInterestChangePayloadSchema>;
export type DiscoverySessionParticipationPayload = z.infer<typeof DiscoverySessionParticipationPayloadSchema>;
export type DiscoveryDailyEnsurePayload = z.infer<typeof DiscoveryDailyEnsurePayloadSchema>;
export type DiscoveryHomePayload = z.infer<typeof DiscoveryHomePayloadSchema>;
export type DiscoveryRecommendationSearchPayload = z.infer<typeof DiscoveryRecommendationSearchPayloadSchema>;
export type DiscoveryRecommendationStatePayload = z.infer<typeof DiscoveryRecommendationStatePayloadSchema>;
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

export interface DiscoveryHost {
  getConfiguration(request?: DiscoveryConfigurationGetPayload): Promise<DiscoveryConfigurationUiDto>;
  updateConfiguration(request: DiscoveryConfigurationUpdatePayload): Promise<DiscoveryConfigurationUiDto>;
  connectSource(request: DiscoverySourceConnectPayload): Promise<DiscoverySourceUiDto>;
  refreshSource(request: DiscoverySourceRefreshPayload): Promise<DiscoverySourceUiDto>;
  refreshSources(request?: DiscoverySourcesRefreshPayload): Promise<DiscoveryConfigurationUiDto>;
  changeInterest(request: DiscoveryInterestChangePayload): Promise<DiscoveryInterestUiDto>;
  setSessionParticipation(request: DiscoverySessionParticipationPayload): Promise<DiscoverySessionParticipationUiDto>;
  ensureDaily(request: DiscoveryDailyEnsurePayload): Promise<DiscoveryDailyEnsureResult>;
  getHome(request: DiscoveryHomePayload): Promise<DiscoveryHomeUiResult>;
  searchRecommendations(request: DiscoveryRecommendationSearchPayload): Promise<DiscoveryRecommendationSearchUiResult>;
  updateRecommendationState(request: DiscoveryRecommendationStatePayload): Promise<DiscoveryRecommendationUiDto>;
}
