/* Defines the provider-neutral contracts shared across the Agent package seam. */
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  TextContent,
  ThinkingLevel,
  Tool,
  ToolResultMessage,
} from '@megumi/ai';

export type AgentMessage = Message;

export interface AgentToolResult<TDetails = unknown> {
  readonly content: readonly (TextContent | ImageContent)[];
  readonly details?: TDetails;
  readonly isError: boolean;
}

export type AgentToolExecutionOutcome<TDetails = unknown> =
  | { readonly status: 'completed'; readonly result: AgentToolResult<TDetails> }
  | {
      readonly status: 'system_failed';
      readonly error: AgentError & { readonly code: 'tool_system_failed' };
    };

export interface AgentTool<TDetails = unknown> extends Tool {
  readonly executionMode?: 'sequential' | 'parallel';
  execute(input: {
    readonly toolCallId: string;
    readonly arguments: unknown;
    readonly signal: AbortSignal;
    readonly onUpdate: (update: AgentToolResult<TDetails>) => void;
  }): Promise<AgentToolExecutionOutcome<TDetails>>;
}

export type AgentToolCall = Extract<
  AssistantMessage['content'][number],
  { readonly type: 'toolCall' }
>;

export interface AgentContext {
  readonly systemPrompt: string;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentTool[];
}

export interface AgentConfiguration {
  readonly systemPrompt: string;
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
  readonly tools: readonly AgentTool[];
}

export type AgentConfigurationPatch = Partial<AgentConfiguration>;

/**
 * The one explicit execution state machine of one Agent Execution. `idle` is the
 * only state without an executionId; every execution-scoped fact carries the
 * same stable executionId, and phase/turn/attempt are reported by the Loop.
 */
export type AgentExecutionPhase =
  | 'preparing_context'
  | 'calling_model'
  | 'executing_tools'
  | 'settling';

export type AgentExecutionState =
  | {
      readonly status: 'idle';
    }
  | {
      readonly status: 'executing';
      readonly executionId: string;
      readonly phase: AgentExecutionPhase;
      readonly turn: number;
      readonly attempt: number;
    }
  | {
      readonly status: 'cancelling';
      readonly executionId: string;
      readonly phase: AgentExecutionPhase;
      readonly turn: number;
      readonly attempt: number;
    };

/** Optional identity for one accepted Agent Execution. */
export interface AgentExecutionOptions {
  readonly executionId?: string;
}

export interface AgentState {
  readonly configuration: AgentConfiguration;
  readonly messages: readonly AgentMessage[];
  /** The only authoritative execution state; idle, executing or cancelling. */
  readonly execution: AgentExecutionState;
  readonly streamingMessage?: AssistantMessage;
  readonly pendingToolCallIds: ReadonlySet<string>;
  readonly lastError?: AgentError;
}

export interface AgentOptions {
  readonly initialState: {
    readonly configuration: AgentConfiguration;
    readonly messages?: readonly AgentMessage[];
  };
  readonly stream: AgentStreamFunction;
  readonly context?: AgentContextProvider;
  readonly policy?: Partial<AgentPolicy>;
  /**
   * Provider-neutral settlement seam awaited inside the `settling` phase before
   * the final result is fixed. A throw forms one `event_listener_failed` result.
   */
  readonly settlement?: AgentSettlement;
}

export type AgentSettlement = (
  result: AgentExecutionResult,
  signal: AbortSignal,
) => void | Promise<void>;

export type AgentStreamFunction = (
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

export interface PrepareAgentContextInput {
  readonly model: Model<Api>;
  readonly context: AgentContext;
  readonly signal: AbortSignal;
}

export interface RecoverAgentContextInput extends PrepareAgentContextInput {
  readonly attempt: number;
}

export type PrepareAgentContextResult =
  | { readonly status: 'ready'; readonly context: AgentContext }
  | { readonly status: 'failed'; readonly error: AgentError }
  | { readonly status: 'cancelled' };

export interface AgentContextProvider {
  prepare(input: PrepareAgentContextInput): Promise<PrepareAgentContextResult>;
  recoverOverflow?(input: RecoverAgentContextInput): Promise<PrepareAgentContextResult>;
}

export type AgentExecutionResult =
  | {
      readonly executionId: string;
      readonly status: 'completed';
      readonly newMessages: readonly AgentMessage[];
      readonly finalMessage: AssistantMessage;
    }
  | {
      readonly executionId: string;
      readonly status: 'failed';
      readonly newMessages: readonly AgentMessage[];
      readonly error: AgentError;
    }
  | {
      readonly executionId: string;
      readonly status: 'cancelled';
      readonly newMessages: readonly AgentMessage[];
    };

export interface AgentError {
  readonly code:
    | 'context_failed'
    | 'model_call_failed'
    | 'tool_system_failed'
    | 'execution_limit_reached'
    | 'event_listener_failed'
    | 'internal_error';
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

export type AgentOperationErrorCode = 'agent_busy' | 'invalid_state';

/**
 * Provider-neutral observable facts of one Agent Execution. The Agent completes
 * the state transition before publishing `execution_state_changed`; ModelCall
 * retries are only `retrying` plus the next `started`, never a second lifecycle.
 */
export type AgentExecutionEvent =
  | {
      readonly type: 'execution_state_changed';
      readonly previous: AgentExecutionState;
      readonly current: AgentExecutionState;
    }
  | {
      readonly type: 'model_call_attempt_started';
      readonly executionId: string;
      readonly turn: number;
      readonly attempt: number;
    }
  | {
      readonly type: 'model_call_attempt_ended';
      readonly executionId: string;
      readonly turn: number;
      readonly attempt: number;
      readonly outcome: 'succeeded' | 'retrying' | 'failed' | 'cancelled';
      readonly error?: AgentError;
    };

export type AgentEvent =
  | AgentExecutionEvent
  | { readonly type: 'agent_start'; readonly executionId: string }
  | { readonly type: 'agent_end'; readonly executionId: string; readonly result: AgentExecutionResult }
  | { readonly type: 'turn_start'; readonly executionId: string }
  | {
      readonly type: 'turn_end';
      readonly executionId: string;
      readonly message: AssistantMessage;
      readonly toolResults: readonly ToolResultMessage[];
    }
  | { readonly type: 'message_start'; readonly executionId: string; readonly message: AgentMessage }
  | { readonly type: 'message_update'; readonly executionId: string; readonly message: AssistantMessage }
  | { readonly type: 'message_end'; readonly executionId: string; readonly message: AgentMessage }
  | {
      readonly type: 'tool_execution_start';
      readonly executionId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly arguments: unknown;
    }
  | {
      readonly type: 'tool_execution_update';
      readonly executionId: string;
      readonly toolCallId: string;
      readonly update: AgentToolResult;
    }
  | {
      readonly type: 'tool_execution_end';
      readonly executionId: string;
      readonly toolCallId: string;
      readonly result: AgentToolResult;
    };

export type AgentEventListener = (
  event: AgentEvent,
  signal: AbortSignal,
) => void | Promise<void>;

export type AgentEventSink = (event: AgentEvent) => Promise<void>;

export interface AgentPolicy {
  readonly maxModelCalls: number;
  readonly maxModelCallAttempts: number;
  readonly maxToolRounds: number;
  readonly maxToolCalls: number;
  readonly maxToolCallsPerModelCall: number;
  readonly maxConcurrentToolCalls: number;
  readonly modelCallTimeoutMs: number;
  readonly toolCallTimeoutMs: number;
  readonly modelRetryDelayMs: number;
  readonly maxContextOverflowRecoveries: number;
}

export type ModelCallPolicy = Pick<
  AgentPolicy,
  | 'maxModelCallAttempts'
  | 'modelCallTimeoutMs'
  | 'modelRetryDelayMs'
  | 'maxContextOverflowRecoveries'
>;

export type ToolCallPolicy = Pick<
  AgentPolicy,
  'maxConcurrentToolCalls' | 'toolCallTimeoutMs'
>;

/**
 * Internal progress facts the Agent Loop reports back to the Agent. The Agent
 * validates every transition and publishes `execution_state_changed`; this type
 * is the Loop's only feedback channel and never a second public state machine.
 */
export interface AgentExecutionProgress {
  readonly phase?: AgentExecutionPhase;
  readonly turn?: number;
  readonly attempt?: number;
}

export type AgentExecutionReporter = (progress: AgentExecutionProgress) => Promise<void>;
