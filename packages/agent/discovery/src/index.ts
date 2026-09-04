/*
 * Exposes Megumi's content-discovery business interface and contracts.
 */
export { createDiscovery } from './discovery';
export type {
  CreateDiscoveryOptions,
  Discovery,
  InterestFacts,
} from './discovery';
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
export type {
  InterestExtractionInput,
  InterestExtractor,
} from './interests/interest-extraction';
export type {
  CreateInterestRuntimeOptions,
  ObserveConversationTurnRequest,
  ObserveConversationTurnResult,
} from './interests/interest-runtime';
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
export { canonicalContentIdentity, normalizeContentUrl, sourceContentIdentity } from './candidate-supply/content-identity';
export { rankRecommendationCandidates } from './recommendation/recommendation-ranking';
export { createRecommendationRuntime, localDateAt } from './recommendation/recommendation-runtime';
export type {
  CreateRecommendationRuntimeOptions,
  RecommendationExecutionInput,
  RecommendationFailure,
  RecommendationFailureCode,
  RecommendationRuntime,
  RecommendationTrigger,
  RequestRecommendationResult,
  StartRecommendationExecutionResult,
  TodayRecommendationResult,
  WaitRecommendationResult,
} from './recommendation/recommendation-runtime';
export { createRecommendationAttempts } from './recommendation/recommendation-attempts';
export type {
  RecommendationAttempts,
  StartRecommendationAttemptRequest,
} from './recommendation/recommendation-attempts';
export { createRecommendationRepository } from './persistence/recommendation-repository';
export type {
  CreateRecommendationRepositoryOptions,
  PendingReactionChange,
  PublishRecommendationItem,
  PublishRecommendationsRequest,
  PublishRecommendationsResult,
  RecommendationRepository,
  UpdateRecommendationStateResult,
} from './persistence/recommendation-repository';
export type { RankRecommendationCandidatesInput } from './recommendation/recommendation-ranking';
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
} from './recommendation/recommendation';
export {
  LocalDateSchema as RecommendationLocalDateSchema,
  RecommendationCollectionSchema,
  RecommendationContentSchema,
  RecommendationDecisionSchema,
  RecommendationSchema,
  RecommendationSelectionBasisSchema,
  RecommendationStateSchema,
  UpdateRecommendationStateRequestSchema,
} from './recommendation/recommendation';
export {
  CandidateInterestMatchSchema,
  CandidatePoolSnapshotSchema,
  CandidateRelevanceSchema,
  CandidateSchema,
  CandidateStatusSchema,
  CandidateSupplyResultSchema,
  CandidateSupplySearchInputSchema,
  CandidateSupplySubmitInputSchema,
} from './candidate-supply/candidate-supply';
export {
  assertCandidateTransition,
  candidateExpiresAt,
  candidatePoolSettings,
} from './candidate-supply/candidate-pool';
export { createCandidateSupplyAttempts } from './candidate-supply/candidate-supply-attempts';
export type {
  CandidateSupplyAttempts,
  CandidateSupplyAttemptSummary,
} from './candidate-supply/candidate-supply-attempts';
export { createCandidateSupplyRuntime } from './candidate-supply/candidate-supply-runtime';
export type {
  CandidateSupplyRuntime,
  CreateCandidateSupplyRuntimeOptions,
} from './candidate-supply/candidate-supply-runtime';
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
} from './candidate-supply/candidate-supply';
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
  DiscoverySourceViewSchema,
  UpdateDiscoveryConfigurationRequestSchema,
} from './configuration/discovery-configuration';
export type {
  DiscoveryConfiguration,
  ConnectDiscoverySourceRequest,
  RefreshDiscoverySourceRequest,
  DiscoveryConfigurationSettings,
  DiscoveryConfigurationStore,
  DiscoveryConfigurationView,
  DiscoverySourceView,
  UpdateDiscoveryConfigurationRequest,
} from './configuration/discovery-configuration';
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
export { createDiscoveryRepository } from './persistence/discovery-repository';
export { createCandidateSupplyRepository } from './persistence/candidate-supply-repository';
export type { CreateCandidateSupplyRepositoryOptions } from './persistence/candidate-supply-repository';
export {
  createContextDiscoverySourceRegistry,
  createDiscoveryFactsReader,
} from './context/discovery-facts-reader';
export type {
  DiscoveryRepository,
  ApplyInterestExtraction,
  ValidatedInterestCommand,
} from './persistence/discovery-repository';
export {
  FeedbackReactionSchema,
  LearnedPreferenceInputSchema,
  LearnedScopeInputSchema,
  PreferenceDimensionSchema,
  PreferenceSchema,
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
  PreferenceSet,
  PreferenceEvidence,
  PreferenceDetail,
  PreferenceLearningFacts,
  PreferenceLearningCompletion,
  PreferenceLearningReactionChange,
  PreferenceLearningTrigger,
  PreferenceSetDetail,
  PreferenceLearningSupport,
  RecommendationContentEvidence,
} from './preferences/preference';
export {
  createPreferenceLearningRepository,
} from './persistence/preference-learning-repository';
export {
  createPreferenceLearningRuntime,
  type CreatePreferenceLearningRuntimeOptions,
  type PreferenceLearningRuntime,
} from './preferences/preference-learning-runtime';
export type {
  PreferenceLearningRepository,
} from './persistence/preference-learning-repository';
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
