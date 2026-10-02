/* Defines the diagnostic write capabilities consumed by the runtime; persistence belongs to Application. */
import type { AssistantMessage, AssistantMessageEvent, JsonValue, SimpleStreamOptions } from '@megumi/ai';

export interface TraceCorrelation {
  readonly requestId?: string;
  readonly executionId?: string;
  readonly sessionId?: string;
  readonly messageId?: string;
  readonly workspaceId?: string;
  readonly compactionId?: string;
  readonly modelCallId?: string;
  readonly toolCallId?: string;
  readonly recommendationId?: string;
  readonly preferenceLearningBatchId?: string;
  readonly contentDigest?: string;
  readonly userMessageId?: string;
  readonly assistantMessageId?: string;
}

export interface OperationCompletion {
  readonly outcome:
    | { readonly status: 'ok'; readonly code?: string }
    | { readonly status: 'error'; readonly code: string; readonly message: string; readonly retryable?: boolean }
    | { readonly status: 'cancelled'; readonly code?: string; readonly message?: string };
  readonly correlation?: TraceCorrelation;
}

export interface SpanOptions<T> {
  readonly name: 'model.resolve' | 'input.process' | 'session.resolve' | 'session.create'
    | 'session.branch.resolve' | 'session.branch.commit' | 'session.message.commit'
    | 'recommendation.reference.resolve' | 'agent.execution' | 'context.build' | 'context.resolve'
    | 'context.compact' | 'prompt.build' | 'model.call' | 'tool.call' | 'permission.await';
  readonly metadata?: { readonly kind: 'tool_call'; readonly toolName: string };
  readonly correlation?: TraceCorrelation;
  readonly classifyResult?: (result: T) => OperationCompletion;
}

export interface Observability {
  /** Observes the input lifecycle without owning its result. */
  withTrace<T>(options: { kind: 'conversation'; correlation?: TraceCorrelation; classifyResult?: (result: T) => OperationCompletion }, operation: () => Promise<T>): Promise<T>;
  /** Observes a named operation without changing its completion contract. */
  withSpan<T>(options: SpanOptions<T>, operation: () => Promise<T>): Promise<T>;
  /** Captures runtime material; the implementation owns redaction and persistence. */
  recordContent(input: {
    kind: 'input.received' | 'input.processed' | 'context.resolved' | 'prompt.final'
      | 'context.compaction.source' | 'context.compaction.summary' | 'model.request' | 'model.response'
      | 'tool.request' | 'tool.arguments' | 'tool.handler_result' | 'tool.result';
    value: unknown; mediaType?: string; correlation?: TraceCorrelation;
  }): void;
  /** Records an instantaneous runtime fact. */
  recordEvent(event:
    | { type: 'context.compaction.triggered'; compactionId: string; trigger: 'threshold' | 'overflow' | 'manual' }
    | { type: 'context.compaction.persisted'; compactionId: string; messageId: string }
    | { type: 'tool.permission.resolved'; toolCallId: string; decision: 'automatic_allow' | 'automatic_deny' | 'user_allow' | 'user_deny'; reasonCode?: string }
  ): void;
  /** Associates duplicate submissions with their original trace. */
  linkTrace(input: { kind: 'duplicate'; target: { by: 'correlation'; traceKind: 'conversation'; correlation: TraceCorrelation; state: 'active' | 'latest_ended' | 'latest_incomplete' }; correlation?: TraceCorrelation }): void;
}

export interface StructuredRuntimeLogger {
  /** Reports runtime diagnostic failures independently of user-visible results. */
  write(input: { level: 'debug' | 'info' | 'warn' | 'error'; module: string; code: string; message: string; correlation?: TraceCorrelation; data?: JsonValue }): void;
}

export interface ProviderCapture {
  readonly options: SimpleStreamOptions;
  /** Observes the original stream without consuming or changing its events. */
  observe(event: AssistantMessageEvent): void;
  /** Completes transport diagnostics after the stream settles. */
  complete(message: AssistantMessage | undefined): void;
}
