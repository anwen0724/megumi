/* Exposes Megumi's shared Agent execution lifecycle and adapter contracts. */
export type {
  AgentExecutions,
  ApprovalDecisionRequest,
  CancelExecutionRequest,
  CancelExecutionResult,
  ConversationExecutionInput,
  ConversationExecutionSnapshot,
  DailyDiscoveryExecutionInput,
  CreateAgentExecutionsOptions,
  GetActiveExecutionRequest,
  GetActiveExecutionResult,
  GetExecutionRequest,
  GetExecutionResult,
  LaunchAgentExecution,
  LaunchAgentExecutionInput,
  LaunchConversationAgentExecutionInput,
  LaunchDailyDiscoveryAgentExecutionInput,
  LaunchedAgentExecution,
  ResolveApprovalRequest,
  ResolveApprovalResult,
  ShutdownRequest,
  ShutdownResult,
  StartExecutionRequest,
  StartExecutionResult,
  StartDailyDiscoveryExecutionResult,
} from './agent-executions';
export { createAgentExecutions } from './agent-executions';
export {
  LaunchExecutionError,
  launchAgentExecution,
} from './execute-agent';
export type {
  DiscoveryAgentPolicy,
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
  createExecutionObserver,
  publishMessageEnded,
  publishTurnEndedProjection,
} from './execution-observer';
export type {
  CreateAgentEventListenerOptions,
  CreateExecutionObserverOptions,
  ExecutionObserver,
  ExecutionProjectionRuntime,
} from './execution-observer';
export { ExecutionRegistry } from './execution-registry';
export type {
  ActiveExecution,
  ApprovalRequest,
  ApprovalResolution,
  BaseExecutionMetadata,
  ConversationExecutionMetadata,
  DailyDiscoveryExecutionMetadata,
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
  DiscoveryAgentToolResultDetails,
  DiscoveryAgentToolUpdateDetails,
} from './tool-adapter';
