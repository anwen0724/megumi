/* Exposes only the stable Context caller contracts, policy, results, and creation entry. */
export type {
  BuildContextRequest,
  BuildContextResult,
  ContextBuilder,
  ContextFailure,
  ContextFailureCode,
  ContextWorkspaceSource,
  ExecutionEnvironment,
  ModelCallContext,
  Prompt,
  RunContext,
} from './context';
export { createContext, type ContextCapabilities, type CreateContextOptions } from './context-builder';
export {
  type CompactContextRequest,
  type CompactContextResult,
  type ContextCompactionProgress,
  type ContextCompactor,
  type CompactionTrigger,
} from './compaction/context-compactor';
export {
  DEFAULT_COMPACTION_POLICY,
  type CompactionPolicy,
  type ContextCapacity,
} from './context-policy';
export {
  type ContextUsageEstimate,
  type DerivedContextUsage,
  deriveContextUsage,
} from './context-usage';
