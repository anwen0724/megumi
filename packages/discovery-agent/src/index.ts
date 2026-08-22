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
