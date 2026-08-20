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

export interface AgentState {
  readonly configuration: AgentConfiguration;
  readonly messages: readonly AgentMessage[];
  readonly status: 'idle' | 'executing';
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
}

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
      readonly status: 'completed';
      readonly newMessages: readonly AgentMessage[];
      readonly finalMessage: AssistantMessage;
    }
  | {
      readonly status: 'failed';
      readonly newMessages: readonly AgentMessage[];
      readonly error: AgentError;
    }
  | { readonly status: 'cancelled'; readonly newMessages: readonly AgentMessage[] };

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

export type AgentEvent =
  | { readonly type: 'agent_start' }
  | { readonly type: 'agent_end'; readonly result: AgentExecutionResult }
  | { readonly type: 'turn_start' }
  | {
      readonly type: 'turn_end';
      readonly message: AssistantMessage;
      readonly toolResults: readonly ToolResultMessage[];
    }
  | { readonly type: 'message_start'; readonly message: AgentMessage }
  | { readonly type: 'message_update'; readonly message: AssistantMessage }
  | { readonly type: 'message_end'; readonly message: AgentMessage }
  | {
      readonly type: 'tool_execution_start';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly arguments: unknown;
    }
  | {
      readonly type: 'tool_execution_update';
      readonly toolCallId: string;
      readonly update: AgentToolResult;
    }
  | {
      readonly type: 'tool_execution_end';
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
