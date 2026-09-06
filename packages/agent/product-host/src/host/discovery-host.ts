/* Defines renderer-safe Discovery DTOs and strict Product Host request/response schemas. */
import { z } from 'zod';
import type { PreferenceLearningStatus } from '@megumi/discovery';
import { PreferenceScopeRequestSchema, PreferenceManagementDetailsSchema, PreferenceEvidenceViewSchema, PreferenceSchema } from '@megumi/discovery';
import type { PreparePreferencesRequest, PreparePreferencesResult } from '@megumi/discovery';
import type { ReadDiscoveryFactsResult, RecommendationFacts } from '@megumi/context';
import {
  CandidatePoolSnapshotSchema,
  CandidateSupplyResultSchema,
  ConnectDiscoverySourceRequestSchema,
  DiscoveryConfigurationViewSchema,
  DiscoveryHomeViewSchema,
  DiscoverySourceViewSchema,
  GetDiscoveryHomeRequestSchema,
  InterestEvidenceSchema,
  InterestSchema,
  PreferenceLearningCompletionSchema,
  RecommendationSchema,
  RecommendationCollectionSchema,
  RecommendationStateSchema,
  UpdateRecommendationStateRequestSchema,
  RecommendationViewSchema,
  RefreshDiscoverySourceRequestSchema,
  SearchRecommendationsRequestSchema,
  SearchRecommendationsResultSchema,
  InterestSessionSettingSchema,
  UpdateDiscoveryConfigurationRequestSchema,
} from '@megumi/discovery';

const LocalDateSchema = z.string().date();
export const DiscoveryPreferenceDetailsPayloadSchema = PreferenceScopeRequestSchema;
export const DiscoveryPreferenceEvidencePayloadSchema = z.object({ preferenceId: z.string().min(1) }).strict();
export const DiscoveryPreferenceDeletePayloadSchema = z.object({ preferenceId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict();
export const DiscoveryPreferenceEditPayloadSchema = DiscoveryPreferenceDeletePayloadSchema.extend({ statement: z.string().trim().refine((value) => [...value].length >= 1 && [...value].length <= 1000) }).strict();
export const DiscoveryPreferenceDetailsResultSchema = z.object({ details: PreferenceManagementDetailsSchema.nullable() }).strict();
export const DiscoveryPreferenceEvidenceResultSchema = z.object({ details: PreferenceEvidenceViewSchema.nullable() }).strict();
export const DiscoveryPreferenceEditResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['updated','unchanged']), preference: PreferenceSchema }).strict(),
  z.object({ status: z.enum(['not_found','revision_conflict','invalid_input']) }).strict(),
]);
export const DiscoveryPreferenceDeleteResultSchema = z.object({ status: z.enum(['deleted','already_deleted','not_found','revision_conflict']) }).strict();
export type DiscoveryPreferenceDetailsPayload = z.infer<typeof DiscoveryPreferenceDetailsPayloadSchema>;
export type DiscoveryPreferenceEvidencePayload = z.infer<typeof DiscoveryPreferenceEvidencePayloadSchema>;
export type DiscoveryPreferenceEditPayload = z.infer<typeof DiscoveryPreferenceEditPayloadSchema>;
export type DiscoveryPreferenceDeletePayload = z.infer<typeof DiscoveryPreferenceDeletePayloadSchema>;
export type DiscoveryPreferenceDetailsResult = z.infer<typeof DiscoveryPreferenceDetailsResultSchema>;
export type DiscoveryPreferenceEvidenceResult = z.infer<typeof DiscoveryPreferenceEvidenceResultSchema>;
export type DiscoveryPreferenceEditResult = z.infer<typeof DiscoveryPreferenceEditResultSchema>;
export type DiscoveryPreferenceDeleteResult = z.infer<typeof DiscoveryPreferenceDeleteResultSchema>;
export const DiscoveryCandidateSupplyConfirmPayloadSchema = z.object({}).strict();
export const DiscoveryCandidateSupplyConfirmResultSchema = z.object({
  status: z.enum(['confirmed', 'already_confirmed']),
}).strict();
export type DiscoveryCandidateSupplyConfirmResult = z.infer<typeof DiscoveryCandidateSupplyConfirmResultSchema>;
const FailureSchema = z.object({
  code: z.string().min(1), message: z.string(), retryable: z.boolean(),
}).strict();
const RecommendationTerminalSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('published'), collection: RecommendationCollectionSchema }).strict(),
  z.object({ status: z.literal('waiting_for_candidates'), localDate: LocalDateSchema }).strict(),
  z.object({ status: z.literal('model_unavailable'), localDate: LocalDateSchema }).strict(),
  z.object({ status: z.literal('failed'), localDate: LocalDateSchema, failure: FailureSchema }).strict(),
  z.object({ status: z.literal('cancelled'), localDate: LocalDateSchema }).strict(),
  z.object({
    status: z.literal('timed_out'), localDate: LocalDateSchema, requestId: z.string().min(1),
  }).strict(),
]);

export const DiscoveryInterestChangePayloadSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), description: z.string().trim().min(1).max(1_000) }).strict(),
  z.object({ action: z.literal('update'), interestId: z.string().min(1), description: z.string().trim().min(1).max(1_000) }).strict(),
  z.object({ action: z.literal('pause'), interestId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('resume'), interestId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('delete'), interestId: z.string().min(1) }).strict(),
]);
export const DiscoveryInterestSessionSettingPayloadSchema = z.object({
  sessionId: z.string().min(1), participation: z.enum(['included', 'excluded']),
}).strict();
export const DiscoveryRecommendationRequestPayloadSchema = z.object({
  trigger: z.enum(['scheduled', 'startup_catchup', 'manual']),
}).strict();
export const DiscoveryRecommendationWaitSchema = z.object({
  requestId: z.string().min(1), timeoutMs: z.number().int().min(1).max(300_000).default(120_000),
}).strict();
export const DiscoveryRecommendationRequestResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('started'), localDate: LocalDateSchema, requestId: z.string().min(1), phase: z.enum(['preparing_preferences','executing']), executionId: z.string().min(1).optional(),
  }).strict(),
  z.object({
    status: z.literal('in_progress'), localDate: LocalDateSchema, requestId: z.string().min(1), phase: z.enum(['preparing_preferences','executing']), executionId: z.string().min(1).optional(),
  }).strict(),
  z.object({ status: z.literal('already_published'), collection: RecommendationCollectionSchema }).strict(),
  z.object({ status: z.literal('waiting_for_candidates'), localDate: LocalDateSchema }).strict(),
  z.object({ status: z.literal('model_unavailable'), localDate: LocalDateSchema }).strict(),
  z.object({ status: z.literal('failed'), localDate: LocalDateSchema, failure: FailureSchema }).strict(),
]);
export const DiscoveryRecommendationWaitResultSchema = RecommendationTerminalSchema;
export const DiscoveryTodayRecommendationResultSchema = z.union([
  z.object({ status: z.literal('not_generated'), localDate: LocalDateSchema }).strict(),
  z.object({
    status: z.literal('running'), localDate: LocalDateSchema, requestId: z.string().min(1), phase: z.enum(['preparing_preferences','executing']), executionId: z.string().min(1).optional(),
  }).strict(),
  RecommendationTerminalSchema,
]);
export const DiscoveryRecommendationCollectionQuerySchema = z.object({
  localDate: LocalDateSchema, includeHidden: z.boolean().default(false),
}).strict();
export const DiscoveryRecommendationIdQuerySchema = z.object({ recommendationId: z.string().min(1) }).strict();
export const DiscoveryHomePayloadSchema = GetDiscoveryHomeRequestSchema;
export const DiscoveryRecommendationSearchPayloadSchema = SearchRecommendationsRequestSchema;
export const DiscoveryRecommendationStatePayloadSchema = UpdateRecommendationStateRequestSchema;
export const DiscoveryInterestFactsPayloadSchema = z.object({
  interestIds: z.array(z.string().min(1)), evidenceIds: z.array(z.string().min(1)),
}).strict();
export const DiscoveryCandidateSupplyRequestSchema = z.object({
  trigger: z.enum(['startup', 'scheduled', 'interest_changed', 'supply_conditions_changed'])
    .default('supply_conditions_changed'),
}).strict();
export const DiscoveryPreferenceLearningQuerySchema = z.object({ recommendationId: z.string().min(1) }).strict();
export const DiscoveryRecommendationFactsQuerySchema = z.object({
  executionId: z.string().min(1), requestId: z.string().min(1), localDate: LocalDateSchema,
}).strict();
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
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
export const DiscoveryInterestSessionSettingUiDtoSchema = InterestSessionSettingSchema;
export const DiscoveryHomeUiResultSchema = DiscoveryHomeViewSchema;
export const DiscoveryRecommendationSearchUiResultSchema = SearchRecommendationsResultSchema;
export const DiscoveryRecommendationUiDtoSchema = RecommendationViewSchema;
export const DiscoveryRecommendationStateResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['updated', 'unchanged']), state: RecommendationStateSchema }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
]);
export const DiscoveryInterestFactsResultSchema = z.object({
  interests: z.array(InterestSchema), evidence: z.array(InterestEvidenceSchema),
}).strict();
export const DiscoveryCandidateSupplyResultSchema = CandidateSupplyResultSchema;
export const DiscoveryCandidatePoolResultSchema = CandidatePoolSnapshotSchema.nullable();
export const DiscoveryRecommendationCollectionResultSchema = RecommendationCollectionSchema.nullable();
export const DiscoveryRecommendationResultSchema = RecommendationSchema.nullable();
export const DiscoveryPreferenceLearningResultSchema = PreferenceLearningCompletionSchema.nullable();

export type DiscoveryInterestChangePayload = z.infer<typeof DiscoveryInterestChangePayloadSchema>;
export type DiscoveryInterestSessionSettingPayload = z.infer<typeof DiscoveryInterestSessionSettingPayloadSchema>;
export type DiscoveryRecommendationRequestPayload = z.infer<typeof DiscoveryRecommendationRequestPayloadSchema>;
export type DiscoveryRecommendationWait = z.infer<typeof DiscoveryRecommendationWaitSchema>;
export type DiscoveryRecommendationRequestResult = z.infer<typeof DiscoveryRecommendationRequestResultSchema>;
export type DiscoveryRecommendationWaitResult = z.infer<typeof DiscoveryRecommendationWaitResultSchema>;
export type DiscoveryTodayRecommendationResult = z.infer<typeof DiscoveryTodayRecommendationResultSchema>;
export type DiscoveryRecommendationCollectionQuery = z.infer<typeof DiscoveryRecommendationCollectionQuerySchema>;
export type DiscoveryRecommendationIdQuery = z.infer<typeof DiscoveryRecommendationIdQuerySchema>;
export type DiscoveryHomePayload = z.infer<typeof DiscoveryHomePayloadSchema>;
export type DiscoveryRecommendationSearchPayload = z.infer<typeof DiscoveryRecommendationSearchPayloadSchema>;
export type DiscoveryRecommendationStatePayload = z.infer<typeof DiscoveryRecommendationStatePayloadSchema>;
export type DiscoveryInterestFactsPayload = z.infer<typeof DiscoveryInterestFactsPayloadSchema>;
export type DiscoveryCandidateSupplyRequest = z.infer<typeof DiscoveryCandidateSupplyRequestSchema>;
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
export type DiscoveryInterestSessionSettingUiDto = z.infer<typeof DiscoveryInterestSessionSettingUiDtoSchema>;
export type DiscoveryHomeUiResult = z.infer<typeof DiscoveryHomeUiResultSchema>;
export type DiscoveryRecommendationSearchUiResult = z.infer<typeof DiscoveryRecommendationSearchUiResultSchema>;
export type DiscoveryRecommendationUiDto = z.infer<typeof DiscoveryRecommendationUiDtoSchema>;
export type DiscoveryRecommendationStateResult = z.infer<typeof DiscoveryRecommendationStateResultSchema>;
export type DiscoveryInterestFactsResult = z.infer<typeof DiscoveryInterestFactsResultSchema>;
export type DiscoveryCandidateSupplyResult = z.infer<typeof DiscoveryCandidateSupplyResultSchema>;
export type DiscoveryCandidatePoolResult = z.infer<typeof DiscoveryCandidatePoolResultSchema>;
export type DiscoveryRecommendationCollectionResult = z.infer<typeof DiscoveryRecommendationCollectionResultSchema>;
export type DiscoveryRecommendationResult = z.infer<typeof DiscoveryRecommendationResultSchema>;
export type DiscoveryPreferenceLearningResult = z.infer<typeof DiscoveryPreferenceLearningResultSchema>;
export type DiscoveryRecommendationFactsResult = ReadDiscoveryFactsResult<RecommendationFacts>;

export type DiscoveryBackgroundWaitResult<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'timed_out' };

export interface DiscoveryHost {
  /** Reads the existing scope without model work. */
  getPreferenceDetails(request: DiscoveryPreferenceDetailsPayload): Promise<DiscoveryPreferenceDetailsResult>;
  /** Reads evidence and distinguishes current feedback from the original learning source. */
  getPreferenceEvidence(request: DiscoveryPreferenceEvidencePayload): Promise<DiscoveryPreferenceEvidenceResult>;
  /** Promotes a preference to the user's explicit requirement. */
  editPreference(request: DiscoveryPreferenceEditPayload): Promise<DiscoveryPreferenceEditResult>;
  /** Deletes a preference under revision protection. */
  deletePreference(request: DiscoveryPreferenceDeletePayload): Promise<DiscoveryPreferenceDeleteResult>;
  /** On-demand preparation for trusted Host workflows; no Desktop learning IPC. */
  preparePreferencesForRecommendation(request: PreparePreferencesRequest): Promise<PreparePreferencesResult>;
  /** Records explicit first-use consent and checks supply in the background. */
  confirmCandidateSupply(): Promise<DiscoveryCandidateSupplyConfirmResult>;
  getConfiguration(request?: DiscoveryConfigurationGetPayload): Promise<DiscoveryConfigurationUiDto>;
  updateConfiguration(request: DiscoveryConfigurationUpdatePayload): Promise<DiscoveryConfigurationUiDto>;
  connectSource(request: DiscoverySourceConnectPayload): Promise<DiscoverySourceUiDto>;
  refreshSource(request: DiscoverySourceRefreshPayload): Promise<DiscoverySourceUiDto>;
  refreshSources(request?: DiscoverySourcesRefreshPayload): Promise<DiscoveryConfigurationUiDto>;
  changeInterest(request: DiscoveryInterestChangePayload): Promise<DiscoveryInterestUiDto>;
  /** Updates a Session's Interest participation setting and returns its durable identity. */
  setInterestSessionSetting(request: DiscoveryInterestSessionSettingPayload): Promise<DiscoveryInterestSessionSettingUiDto>;
  requestRecommendation(request: DiscoveryRecommendationRequestPayload): Promise<DiscoveryRecommendationRequestResult>;
  waitRecommendation(request: DiscoveryRecommendationWait): Promise<DiscoveryRecommendationWaitResult>;
  getTodayRecommendation(): Promise<DiscoveryTodayRecommendationResult>;
  getRecommendationCollection(request: DiscoveryRecommendationCollectionQuery): Promise<DiscoveryRecommendationCollectionResult>;
  getRecommendationById(request: DiscoveryRecommendationIdQuery): Promise<DiscoveryRecommendationResult>;
  getHome(request: DiscoveryHomePayload): Promise<DiscoveryHomeUiResult>;
  searchRecommendations(request: DiscoveryRecommendationSearchPayload): Promise<DiscoveryRecommendationSearchUiResult>;
  updateRecommendationState(request: DiscoveryRecommendationStatePayload): Promise<DiscoveryRecommendationStateResult>;
  getInterestFacts(request: DiscoveryInterestFactsPayload): Promise<DiscoveryInterestFactsResult>;
  requestCandidateSupply(request?: DiscoveryCandidateSupplyRequest): Promise<DiscoveryCandidateSupplyResult>;
  getCandidatePool(): Promise<DiscoveryCandidatePoolResult>;
  getRecommendationFacts(request: z.infer<typeof DiscoveryRecommendationFactsQuerySchema>): Promise<DiscoveryRecommendationFactsResult>;
  /** Returns current/learned feedback versions and persisted Preference details, not a run record. */
  getPreferenceLearning(request: DiscoveryPreferenceLearningQuery): Promise<DiscoveryPreferenceLearningResult>;
  getPreferenceLearningStatus(request: DiscoveryPreferenceLearningQuery): Promise<PreferenceLearningStatus>;
  /** Waits for the current feedback revision to be learned, or returns a bounded timeout. */
  waitPreferenceLearning(
    request: DiscoveryPreferenceLearningQuery & DiscoveryBackgroundWaitOptions,
  ): Promise<DiscoveryBackgroundWaitResult<NonNullable<DiscoveryPreferenceLearningResult>>>;
}
