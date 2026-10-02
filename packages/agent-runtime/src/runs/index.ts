/* Exposes Megumi's shared Agent execution lifecycle and adapter contracts. */
export type {
  RunManager,
  ApprovalDecisionRequest,
  CancelExecutionRequest,
  CancelExecutionResult,
  ConversationExecutionInput,
  CandidateSupplyExecutionInput,
  ConversationExecutionSnapshot,
  RecommendationExecutionInput,
  CreateRunManagerOptions,
  GetActiveExecutionRequest,
  GetActiveExecutionResult,
  GetExecutionRequest,
  GetExecutionResult,
  PrepareRun,
  LaunchAgentExecutionInput,
  LaunchConversationAgentExecutionInput,
  LaunchCandidateSupplyExecutionInput,
  LaunchRecommendationExecutionInput,
  PreparedRun,
  ResolveApprovalRequest,
  ResolveApprovalResult,
  ShutdownRequest,
  ShutdownResult,
  StartExecutionRequest,
  StartExecutionResult,
  StartRecommendationExecutionResult,
  StartCandidateSupplyExecutionResult,
} from './run-manager';
export { createRunManager } from './run-manager';
export { createConversationSubmission } from './submit-input';
export type {
  ConversationBranchCommit,
  ConversationModelResolution,
  ConversationSubmission,
  ConversationSubmissionDependencies,
  ConversationSubmissionFailure,
  SubmitConversationInputRequest,
  SubmitConversationInputResult,
} from './submit-input';
export {
  LaunchExecutionError,
  prepareRun,
} from './execute-run';
export type {
  AgentExecutionPolicy,
  RunDependencies,
} from './execute-run';
export {
  createContextAdapter,
  releaseActiveScope,
} from './context-adapter';
export type {
  ContextAdapterDependencies,
  ContextAdapterRuntime,
  ToolScope,
} from './context-adapter';
export {
  createAgentEventListener,
  publishMessageEnded,
  publishTurnEndedProjection,
} from './run-events';
export type {
  CreateAgentEventListenerOptions,
  ExecutionProjectionRuntime,
} from './run-events';
export { RunRegistry } from './run-registry';
export type {
  ActiveExecution,
  ApprovalRequest,
  ApprovalResolution,
  BaseExecutionMetadata,
  ConversationExecutionMetadata,
  CandidateSupplyExecutionMetadata,
  RecommendationExecutionMetadata,
  ExecutionClock,
  ExecutionFailure,
  ExecutionFailureCode,
  ExecutionMetadata,
  ExecutionOutcome,
  ExecutionSnapshot,
  ExecutionStatus,
  PendingApproval,
  ReserveStartResult,
  StartRequestFingerprint,
  StoredStartResult,
  TerminalExecution,
} from './run-registry';
export {
  createSessionMessageCommitter,
  SessionCommitError,
} from './session-settlement';
export type {
  AssistantReplyMetadata,
  SessionMessageCommitter,
  SessionToolResultCommit,
} from './session-settlement';
export { createAgentTool, createUnprotectedAgentTool } from './tool-adapter';
export type {
  AgentToolResultDetails,
  AgentToolUpdateDetails,
} from './tool-adapter';
