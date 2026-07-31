/* Exposes only the stable Context caller contracts, policy, results, and creation entry. */
export {
  createContext,
  type BuildContextRequest,
  type BuildContextResult,
  type ContextBuilder,
  type ContextCapabilities,
  type ContextFailure,
  type CreateContextOptions,
  type InstructionScopeResolver,
  type PreparedModelCall,
} from './context-builder';
export {
  type CompactContextRequest,
  type CompactContextResult,
  type ContextCompactionProgress,
  type ContextCompactor,
} from './compaction/context-compactor';
export {
  DEFAULT_CONTEXT_POLICY,
  type ContextCapacity,
  type ContextPolicy,
} from './context-policy';
export {
  type ContextUsage,
  type ContextUsageReader,
  type ContextUsageRecorder,
  type ContextUsageSnapshotCache,
  type GetSessionContextUsageRequest,
  type GetSessionContextUsageResult,
  type RecordCompletedModelCallUsageRequest,
  type RecordCompletedModelCallUsageResult,
  type SessionContextUsageSnapshot,
} from './context-usage';
export {
  type ContextSourceRef,
  type VisibleCompactionSummary,
} from './active-context';
export {
  type ConversationItem,
  type ConversationRun,
  type ConversationRuntimeSource,
  type CurrentConversationRun,
} from './conversation-run';
