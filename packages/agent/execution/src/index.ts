/* Exposes Megumi's shared Agent execution lifecycle and adapter contracts. */
export type {
  AgentExecutions,
  ApprovalDecisionRequest,
  CancelExecutionRequest,
  CancelExecutionResult,
  ConversationExecutionInput,
  CandidateSupplyExecutionInput,
  ConversationExecutionSnapshot,
  DailyRecommendationExecutionInput,
  CreateAgentExecutionsOptions,
  GetActiveExecutionRequest,
  GetActiveExecutionResult,
  GetExecutionRequest,
  GetExecutionResult,
  LaunchAgentExecution,
  LaunchAgentExecutionInput,
  LaunchConversationAgentExecutionInput,
  LaunchCandidateSupplyExecutionInput,
  LaunchDailyRecommendationExecutionInput,
  LaunchedAgentExecution,
  ResolveApprovalRequest,
  ResolveApprovalResult,
  ShutdownRequest,
  ShutdownResult,
  StartExecutionRequest,
  StartExecutionResult,
  StartDailyRecommendationExecutionResult,
  StartCandidateSupplyExecutionResult,
} from './agent-executions';
export { createAgentExecutions } from './agent-executions';
export { createConversationSubmission } from './conversation-submission';
export type {
  ConversationBranchCommit,
  ConversationModelResolution,
  ConversationSubmission,
  ConversationSubmissionDependencies,
  ConversationSubmissionFailure,
  SubmitConversationInputRequest,
  SubmitConversationInputResult,
} from './conversation-submission';
export {
  LaunchExecutionError,
  launchAgentExecution,
} from './execute-agent';
export type {
  AgentExecutionPolicy,
  ExecuteAgentDependencies,
} from './execute-agent';
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
} from './execution-projection';
export type {
  CreateAgentEventListenerOptions,
  ExecutionProjectionRuntime,
} from './execution-projection';
export { ExecutionRegistry } from './execution-registry';
export type {
  ActiveExecution,
  ApprovalRequest,
  ApprovalResolution,
  BaseExecutionMetadata,
  ConversationExecutionMetadata,
  CandidateSupplyExecutionMetadata,
  DailyRecommendationExecutionMetadata,
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
} from './execution-registry';
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
