/* Exposes only the Discovery Agent public interface, construction entry and operation contracts. */
export { createDiscoveryAgent } from './discovery-agent';
export type {
  CreateDiscoveryAgentOptions,
  DiscoveryAgent,
} from './discovery-agent';
export type {
  ApprovalDecisionRequest,
  CancelExecutionRequest,
  CancelExecutionResult,
  GetActiveExecutionRequest,
  GetActiveExecutionResult,
  GetExecutionRequest,
  GetExecutionResult,
  ResolveApprovalRequest,
  ResolveApprovalResult,
  ShutdownRequest,
  ShutdownResult,
  StartExecutionRequest,
  StartExecutionResult,
} from '@megumi/execution';
export type {
  ConversationBranchCommit,
  ConversationModelResolution,
  ConversationSubmissionFailure,
  ConversationSubmissionDependencies,
  SubmitConversationInputRequest,
  SubmitConversationInputResult,
} from './conversation/submit-conversation-input';
export type {
  DiscoveryAgentPolicy,
  ExecutionClock,
  ExecutionFailure,
  ExecutionFailureCode,
  ExecutionSnapshot,
  ExecutionStatus,
} from '@megumi/execution';
export {
  InterestCreatedFromSchema,
  InterestDescriptionSchema,
  InterestEvidenceSchema,
  InterestExtractionResultSchema,
  InterestSchema,
  InterestStatusSchema,
  SessionParticipationSchema,
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
  SessionParticipation,
  SetSessionParticipationRequest,
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
export type { SourceRegistry } from './sources/source-registry';
export { createOpenWebSource } from './sources/open-web-source';
export { createBilibiliSource } from './sources/bilibili-source';
export { createXiaohongshuSource } from './sources/xiaohongshu-source';
export { createDouyinSource } from './sources/douyin-source';
export { createZhihuSource } from './sources/zhihu-source';
export { createDiscoverySourceRegistry, DISCOVERY_SOURCE_IDS } from './sources/source-catalog';
export { signBilibiliWbiParameters } from './sources/bilibili-wbi';
export {
  createCandidateRegistry,
  discoveryContentIdentity,
} from './daily-discovery/candidate-registry';
export { createDailyDiscoveryAttempts } from './daily-discovery/daily-discovery-attempt';
export type {
  DailyDiscoveryAttempts,
  DailyDiscoveryAttemptState,
} from './daily-discovery/daily-discovery-attempt';
export { canonicalContentIdentity, normalizeContentUrl, sourceContentIdentity } from './daily-discovery/content-identity';
export type {
  CandidateRegistry,
  DiscoveryCandidate,
} from './daily-discovery/candidate-registry';
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
  DiscoveryConfigurationViewSchema,
  DiscoverySourceViewSchema,
  UpdateDiscoveryConfigurationRequestSchema,
} from './configuration/discovery-configuration';
export {
  BrowserSourceIdSchema,
  BrowserSourceItemSchema,
  BrowserSourceTaskRequestSchema,
  BrowserSourceTaskResultSchema,
} from './browser-sources/browser-source-contracts';
export type {
  BrowserSourceId,
  BrowserSourceItem,
  BrowserSourceTaskGateway,
  BrowserSourceTaskRequest,
  BrowserSourceTaskResult,
} from './browser-sources/browser-source-contracts';
export type {
  DiscoveryConfiguration,
  DiscoveryConfigurationSettings,
  DiscoveryConfigurationStore,
  DiscoveryConfigurationView,
  DiscoverySourceView,
  UpdateDiscoveryConfigurationRequest,
} from './configuration/discovery-configuration';
export {
  DailyDiscoveryBatchSchema,
  DailyDiscoveryBatchStatusSchema,
  DiscoveryFailureViewSchema,
  EnsureDailyDiscoveryRequestSchema,
  LocalDateSchema,
} from './daily-discovery/daily-discovery';
export type {
  CreateDailyDiscoveryRuntimeOptions,
  DailyDiscoveryRuntime,
} from './daily-discovery/daily-discovery-runtime';
export type {
  DailyDiscoveryBatch,
  DiscoveryFailureView,
  EnsureDailyDiscoveryRequest,
  EnsureDailyDiscoveryResult,
} from './daily-discovery/daily-discovery';
export {
  RecommendationReferenceContentSchema,
  RecommendationSchema,
  UpdateRecommendationStateRequestSchema,
} from './recommendations/recommendation';
export type {
  Recommendation,
  RecommendationReferenceContent,
  UpdateRecommendationStateRequest,
} from './recommendations/recommendation';
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
export type {
  ClaimDailyBatch,
  ClaimDailyBatchResult,
  DiscoveryRepository,
  FailDailyAttemptResult,
  ApplyInterestExtraction,
  PublishDailyBatch,
  PublishDailyBatchResult,
  RecommendationSelectionSignal,
  ValidatedInterestCommand,
} from './persistence/discovery-repository';
export type {
  ReadHomeQuery,
  RecommendationStateCommand,
} from './persistence/discovery-query-repository';
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
