/*
 * Exposes Megumi's content-discovery business interface and contracts.
 */
export { createDiscovery } from './discovery';
export type { CreateDiscoveryOptions, Discovery, InterestFacts } from './discovery';
export {
  InterestCreatedFromSchema,
  InterestDescriptionSchema,
  InterestEvidenceSchema,
  InterestExtractionResultSchema,
  InterestSchema,
  InterestStatusSchema,
  InterestSessionSettingSchema,
} from './interests/interest';
export { createInterestExtractor } from './interests/interest-extraction';
export type { InterestExtractionInput, InterestExtractor } from './interests/interest-extraction';
export type {
  CreateInterestsOptions,
  ObserveConversationTurnRequest,
  ObserveConversationTurnResult,
} from './interests/interests';
export type {
  ChangeInterestRequest,
  Interest,
  InterestEvidence,
  InterestExtractionResult,
  InterestSessionSetting,
  SetInterestSessionSettingRequest,
} from './interests/interest';
export {
  DiscoveryContentTypeSchema,
  DiscoverySourceIdSchema,
  SourceContentDetailSchema,
  SourceContentSchema,
  SourceDescriptorSchema,
  SourceEngagementSchema,
  SourceFailureSchema,
  SourceAccessKindSchema,
  SourceAvailabilitySchema,
  SourceConnectionStateSchema,
  SourceSearchModeSchema,
} from './sources/discovery-source';
export { createSourceRegistry } from './sources/source-registry';
export type {
  EmbeddedBrowser,
  EmbeddedBrowserFailure,
  EmbeddedBrowserLink,
  EmbeddedBrowserProfileId,
  EmbeddedBrowserSnapshot,
  EmbeddedBrowserSnapshotResult,
} from './sources/embedded-browser';
export type { SourceRegistry } from './sources/source-registry';
export { createOpenWebSource } from './sources/open-web-source';
export { createBilibiliSource } from './sources/bilibili-source';
export { createXiaohongshuSource } from './sources/xiaohongshu-source';
export { createDouyinSource } from './sources/douyin-source';
export { createZhihuSource } from './sources/zhihu-source';
export { createTwitterSource } from './sources/twitter-source';
export { createDiscoverySourceRegistry, DISCOVERY_SOURCE_IDS } from './sources/source-catalog';
export { signBilibiliWbiParameters } from './sources/bilibili-wbi';
export {
  canonicalContentIdentity,
  normalizeContentUrl,
  sourceContentIdentity,
} from './candidates/content-identity';
export { rankRecommendationCandidates } from './recommendations/recommendation-ranking';
export { createRecommendations, localDateAt } from './recommendations/recommendations';
export type {
  CreateRecommendationsOptions,
  RecommendationFailure,
  RecommendationFailureCode,
  Recommendations,
  RecommendationTrigger,
  RequestRecommendationResult,
  TodayRecommendationResult,
  WaitRecommendationResult,
} from './recommendations/recommendations';
export { createRecommendationAttempts } from './recommendations/recommendation-attempts';
export type {
  RecommendationAttempts,
  StartRecommendationAttemptRequest,
} from './recommendations/recommendation-attempts';
export { createRecommendationRepository } from './recommendations/recommendation-repository';
export type {
  CreateRecommendationRepositoryOptions,
  PendingReactionChange,
  PublishRecommendationItem,
  PublishRecommendationsRequest,
  PublishRecommendationsResult,
  RecommendationRepository,
  UpdateRecommendationStateResult,
} from './recommendations/recommendation-repository';
export type { RankRecommendationCandidatesInput } from './recommendations/recommendation-ranking';
export type {
  Recommendation,
  RecommendationCollection,
  RecommendationContent,
  RecommendationDecision,
  RecommendationSelectionBasis,
  RecommendationState,
  UpdateRecommendationStateRequest,
  RankedRecommendationCandidate,
  RecommendationCandidate,
  RecommendationExclusionReason,
  RecommendationHistoryItem,
  RecommendationRankingResult,
} from './recommendations/recommendation';
export {
  LocalDateSchema as RecommendationLocalDateSchema,
  RecommendationCollectionSchema,
  RecommendationContentSchema,
  RecommendationDecisionSchema,
  RecommendationSchema,
  RecommendationSelectionBasisSchema,
  RecommendationStateSchema,
  UpdateRecommendationStateRequestSchema,
} from './recommendations/recommendation';
export {
  CandidateInterestMatchSchema,
  CandidatePoolSnapshotSchema,
  CandidateRelevanceSchema,
  CandidateSchema,
  CandidateStatusSchema,
  CandidateSupplyResultSchema,
  CandidateSupplySearchInputSchema,
  CandidateSupplySubmitInputSchema,
} from './candidates/candidate-supply';
export {
  assertCandidateTransition,
  candidateExpiresAt,
  candidatePoolSettings,
} from './candidates/candidate-pool';
export { createCandidateSupplyAttempts } from './candidates/candidate-supply-attempts';
export type {
  CandidateSupplyAttempts,
  CandidateSupplyAttemptSummary,
} from './candidates/candidate-supply-attempts';
export { createCandidates } from './candidates/candidates';
export type { Candidates, CreateCandidatesOptions } from './candidates/candidates';
export type {
  Candidate,
  CandidateIdentity,
  CandidateInterestMatch,
  CandidatePoolSettings,
  CandidatePoolSnapshot,
  CandidateStatus,
  CandidateSubmissionResult,
  CandidateSupplyRepository,
  CandidateSupplyResult,
  CandidateSupplySearchInput,
  CandidateSupplySubmitInput,
  CandidateSupplyTrigger,
  CandidateWithMatches,
  SubmitCandidateRequest,
} from './candidates/candidate-supply';
export type {
  DiscoveryContentType,
  DiscoverySource,
  DiscoverySourceId,
  SourceAccessKind,
  SourceAvailability,
  SourceConnectionState,
  SourceContent,
  SourceContentDetail,
  SourceDescriptor,
  SourceEngagement,
  SourceFailure,
  SourceReadResult,
  SourceSearchMode,
  SourceSearchResult,
} from './sources/discovery-source';
export {
  createDiscoveryConfiguration,
  ConnectDiscoverySourceRequestSchema,
  RefreshDiscoverySourceRequestSchema,
  DiscoveryConfigurationViewSchema,
  DiscoveryConfigurationUpdateResultSchema,
  DiscoverySourceViewSchema,
  UpdateDiscoveryConfigurationRequestSchema,
} from './discovery-configuration';
export type {
  DiscoveryConfiguration,
  ConnectDiscoverySourceRequest,
  RefreshDiscoverySourceRequest,
  DiscoveryConfigurationSettings,
  DiscoveryConfigurationStore,
  DiscoveryConfigurationView,
  DiscoveryConfigurationUpdateResult,
  DiscoverySourceView,
  UpdateDiscoveryConfigurationRequest,
} from './discovery-configuration';
export {
  DiscoveryDayViewSchema,
  DiscoveryHomeModeSchema,
  DiscoveryHomeViewSchema,
  GetDiscoveryHomeRequestSchema,
  InterestViewSchema,
  RecommendationViewSchema,
  SearchRecommendationsRequestSchema,
  SearchRecommendationsResultSchema,
  TodayDiscoveryViewSchema,
} from './discovery-view';
export { createDiscoveryRepository } from './discovery-repository';
export {
  DiscoveryStateSchema,
  getDiscoveryState,
  initializeDiscoveryState,
} from './discovery-state';
export type { DiscoveryState } from './discovery-state';
export { createCandidateSupplyRepository } from './candidates/candidate-supply-repository';
export type { CreateCandidateSupplyRepositoryOptions } from './candidates/candidate-supply-repository';
export {
  createContextDiscoverySourceRegistry,
  createDiscoveryFactsReader,
} from './discovery-facts-reader';
export type {
  DiscoveryRepository,
  ApplyInterestExtraction,
  ValidatedInterestCommand,
} from './discovery-repository';
export {
  FeedbackReactionSchema,
  LearnedScopeInputSchema,
  PreferenceDimensionSchema,
  PreferenceSchema,
  PreferenceScopeRequestSchema,
  PreferenceManagementDetailsSchema,
  PreferenceEvidenceViewSchema,
  PreferenceSetSchema,
  PreferenceEvidenceSchema,
  PreferenceDetailSchema,
  PreferenceLearningCompletionSchema,
  PreferencePolaritySchema,
  PreferenceScopeSchema,
  PreferenceSetDetailSchema,
  RecommendationContentEvidenceSchema,
} from './preferences/preference';
export type {
  CommitPreferenceLearningResult,
  FeedbackReaction,
  LearnedScopeInput,
  Preference,
  PreferenceScopeRequest,
  PreferenceManagementDetails,
  PreferenceEvidenceView,
  PreferenceSet,
  PreferenceEvidence,
  PreferenceDetail,
  PreferenceLearningFacts,
  PreferenceLearningCompletion,
  PreferenceLearningReactionChange,
  PreferenceSetDetail,
  PreferenceLearningSupport,
  RecommendationContentEvidence,
} from './preferences/preference';
export { createPreferenceLearningRepository } from './preferences/preference-learning-repository';
export {
  createPreferenceLearning,
  type CreatePreferenceLearningOptions,
  type PreferenceLearning,
  type PreferenceLearningStatus,
  type PreparePreferencesRequest,
  type PreparePreferencesResult,
} from './preferences/preference-learning';
export type {
  PreferenceLearningRepository,
  PreferenceEditResult,
  PreferenceDeleteResult,
} from './preferences/preference-learning-repository';
export type {
  DiscoveryDayView,
  DiscoveryHomeMode,
  DiscoveryHomeView,
  GetDiscoveryHomeRequest,
  InterestView,
  RecommendationView,
  SearchRecommendationsRequest,
  SearchRecommendationsResult,
  TodayDiscoveryView,
} from './discovery-view';

export {
  PreparePreferencesRequestSchema,
  PreparePreferencesResultSchema,
} from './preferences/preference-learning';
