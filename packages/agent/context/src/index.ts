/* Exposes only the stable Context caller contracts, policy, results, and creation entry. */
export type {
  BaseRunContext,
  BuildContextRequest,
  BuildContextResult,
  CompactContextRequest,
  CompactContextResult,
  CompactionTrigger,
  ConversationRunContext,
  CandidateSupplyContextMaterial,
  CandidateSupplyRunContext,
  ContextBuilder,
  ContextCompactionProgress,
  ContextCompactor,
  ContextFailure,
  ContextFailureCode,
  ContextWorkspaceSource,
  DailyDiscoveryContextMaterial,
  DailyDiscoveryRunContext,
  DailyRecommendationContextMaterial,
  DailyRecommendationHistoryItem,
  DailyRecommendationRunContext,
  ExecutionEnvironment,
  ModelCallContext,
  Prompt,
  RunContext,
} from './context';
export { createContext, type ContextCapabilities, type CreateContextOptions } from './context-builder';
export {
  DEFAULT_COMPACTION_POLICY,
  type CompactionPolicy,
  type ContextCapacity,
} from './context-policy';
export {
  type ContextUsageEstimate,
  type DerivedContextUsage,
  deriveContextUsage,
} from './context-usage-calculator';
export { materializeRecommendationReference } from './prompt/recommendation-reference-content';
