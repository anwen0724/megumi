/* Exposes the stable public Agent interface without leaking execution internals. */
export { Agent, AgentOperationError } from './agent';

export type {
  AgentConfiguration,
  AgentConfigurationPatch,
  AgentContext,
  AgentContextProvider,
  AgentError,
  AgentEvent,
  AgentEventListener,
  AgentExecutionResult,
  AgentMessage,
  AgentOperationErrorCode,
  AgentOptions,
  AgentPolicy,
  AgentState,
  AgentStreamFunction,
  AgentTool,
  AgentToolCall,
  AgentToolExecutionOutcome,
  AgentToolResult,
} from './types';
