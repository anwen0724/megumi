/* Exposes only the Discovery Agent public interface, construction entry and operation contracts. */
export { createDiscoveryAgent } from './discovery-agent';
export type {
  ApprovalDecisionRequest,
  CancelExecutionRequest,
  CancelExecutionResult,
  CreateDiscoveryAgentOptions,
  DiscoveryAgent,
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
} from './discovery-agent';
export type {
  ConversationBranchCommit,
  ConversationModelResolution,
  ConversationSubmissionFailure,
  ConversationSubmissionDependencies,
  SubmitConversationInputRequest,
  SubmitConversationInputResult,
} from './conversation/submit-conversation-input';
export type {
  ExecutionClock,
  ExecutionFailure,
  ExecutionFailureCode,
  ExecutionSnapshot,
  ExecutionStatus,
} from './execution/execution-registry';
export type { DiscoveryAgentPolicy } from './execution/execute-agent';
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
  SourceSearchModeSchema,
} from './sources/discovery-source';
export { createSourceRegistry } from './sources/source-registry';
export type { SourceRegistry } from './sources/source-registry';
export { createOpenWebSource } from './sources/open-web-source';
export { createBilibiliSource } from './sources/bilibili-source';
export { signBilibiliWbiParameters } from './sources/bilibili-wbi';
export { createCandidateRegistry } from './daily-discovery/candidate-registry';
export type {
  CandidateRegistry,
  DiscoveryCandidate,
} from './daily-discovery/candidate-registry';
export type {
  DiscoveryContentType,
  DiscoverySource,
  DiscoverySourceId,
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
  DailyDiscoveryBatchSchema,
  DailyDiscoveryBatchStatusSchema,
  DiscoveryFailureViewSchema,
  EnsureDailyDiscoveryRequestSchema,
  LocalDateSchema,
} from './daily-discovery/daily-discovery';
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
  ApplyInterestExtraction,
  PublishDailyBatch,
  PublishDailyBatchResult,
  ValidatedInterestCommand,
} from './persistence/discovery-repository';
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
