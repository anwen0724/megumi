/*
 * Constructs one Agent for an accepted execution, connects the Context, Tool,
 * Session settlement and Observability adapters, and starts the single Agent
 * Execution. The Agent's settlement seam commits the unique final Assistant
 * Reply inside the settling phase; this module only maps the fixed
 * AgentExecutionResult into the Discovery Agent ExecutionOutcome.
 */
import {
  Agent,
  type AgentExecutionResult,
  type AgentMessage,
  type AgentPolicy,
  type AgentSettlement,
  type AgentStreamFunction,
} from '@megumi/agent';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Models,
} from '@megumi/ai';
import type { ContextCapabilities } from '@megumi/context';
import type { EventBus } from '@megumi/events';
import type { UserInput } from '@megumi/input';
import type { ObservabilityService } from '@megumi/observability';
import type { Permissions } from '@megumi/permissions';
import type { SessionHistory } from '@megumi/session';
import type { Tools } from '@megumi/tools';
import type {
  LaunchedAgentExecution,
  LaunchAgentExecutionInput,
} from '../discovery-agent';
import type {
  ExecutionClock,
  ExecutionFailure,
  ExecutionMetadata,
  ExecutionOutcome,
} from './execution-registry';
import {
  createContextAdapter,
  releaseActiveScope,
  type ContextAdapterRuntime,
} from './context-adapter';
import {
  createAgentEventListener,
  createExecutionObserver,
  publishMessageEnded,
  publishTurnEndedProjection,
  type CreateAgentEventListenerOptions,
  type ExecutionObserver,
  type ExecutionProjectionRuntime,
} from './execution-observer';
import {
  createSessionMessageCommitter,
  SessionCommitError,
  type AssistantReplyMetadata,
  type SessionMessageCommitter,
} from './session-settlement';
import { createAgentTool } from './tool-adapter';

export interface DiscoveryAgentPolicy {
  readonly maxModelCallsPerExecution: number;
  readonly maxToolRoundsPerExecution: number;
  readonly maxToolCallsPerModelCall: number;
  readonly maxToolCallsPerExecution: number;
  readonly maxConcurrentToolExecutions: number;
  readonly modelCallTimeoutMs: number;
  readonly toolExecutionTimeoutMs: number;
  readonly maxModelCallAttempts: number;
  readonly modelRetryDelayMs: number;
  readonly maxContextOverflowRecoveries: number;
  /** Provider Request Retry budget passed to the AI adapter. */
  readonly providerRequestMaxRetries: number;
  /** Provider Request Retry delay cap passed to the AI adapter. */
  readonly providerRequestMaxRetryDelayMs: number;
}

export interface ExecuteAgentDependencies {
  readonly models: Models;
  readonly context: ContextCapabilities;
  readonly tools: Pick<
    Tools,
    'resolveModelCallTools' | 'routeToolCall' | 'executeToolInvocation' | 'releaseModelCallTools'
  >;
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly session: Pick<
    SessionHistory,
    'saveUserMessage' | 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'
  >;
  readonly events: EventBus;
  readonly observability?: ObservabilityService;
  readonly ids: {
    createModelCallId(): string;
    createToolExecutionId(): string;
    createApprovalId(): string;
    createSessionMessageId(): string;
  };
  readonly clock: ExecutionClock;
  readonly policy: DiscoveryAgentPolicy;
}

/** A launch failure carries its real ExecutionFailure so start() preserves the cause. */
export class LaunchExecutionError extends Error {
  readonly failure: ExecutionFailure;

  constructor(failure: ExecutionFailure) {
    super(failure.message);
    this.name = 'LaunchExecutionError';
    this.failure = failure;
  }
}

interface ExecutionRuntime extends ExecutionProjectionRuntime, ContextAdapterRuntime {
  readonly committer: SessionMessageCommitter;
  readonly observer: ExecutionObserver;
  assistantMessageId?: string;
}

export async function launchAgentExecution(
  input: LaunchAgentExecutionInput,
  dependencies: ExecuteAgentDependencies,
): Promise<LaunchedAgentExecution> {
  const { metadata } = input;

  // 1. The User Message commits before the Agent exists; failure fails the start.
  const saved = await dependencies.session.saveUserMessage({
    message_id: metadata.userMessageId,
    session_id: metadata.sessionId,
    execution_id: metadata.executionId,
    display_content: [...input.input.displayContent],
    model_content: [...input.input.modelContent],
    ...(input.input.skillSelection ? {
      skill_selection: {
        name: input.input.skillSelection.name,
        skill_path: input.input.skillSelection.skillPath,
      },
    } : {}),
    attachments: input.input.attachments.map((attachment) => (
      attachment.type === 'image'
        ? {
            type: 'image' as const,
            name: attachment.name,
            media_type: attachment.mediaType,
            byte_length: attachment.byteLength,
            bytes: attachment.bytes,
          }
        : {
            type: 'file' as const,
            name: attachment.name,
            media_type: attachment.mediaType,
            local_path: attachment.localPath,
            size_bytes: attachment.sizeBytes,
          }
    )),
    ...(metadata.parentEntryId ? { parent_entry_id: metadata.parentEntryId } : {}),
    created_at: metadata.createdAt,
  });
  if (saved.status === 'failed') {
    throw new LaunchExecutionError({
      code: 'session_failed',
      message: saved.failure.message,
      retryable: false,
      cause: { owner: 'session', code: saved.failure.code },
    });
  }

  // 2. Build the per-execution runtime and its adapters.
  const observer = createExecutionObserver({ metadata, observability: dependencies.observability });
  const runtime: ExecutionRuntime = {
    toolRequests: new Map(),
    toolSystemFailures: new Map(),
    committer: createSessionMessageCommitter({
      userEntry: saved.entry,
      session: dependencies.session,
      ids: dependencies.ids,
    }),
    observer,
  };

  const toolAdapter = createAgentTool({
    metadata,
    tools: dependencies.tools,
    permissions: dependencies.permissions,
    ids: dependencies.ids,
    clock: dependencies.clock,
    events: dependencies.events,
    observer,
    awaitApproval: input.awaitApproval,
    toolSystemFailures: runtime.toolSystemFailures,
  });
  const contextDependencies = {
    metadata,
    userInput: input.input,
    context: dependencies.context,
    tools: dependencies.tools,
    ids: dependencies.ids,
    observer,
    createAgentTool: toolAdapter,
  };
  const contextProvider = createContextAdapter(contextDependencies, runtime);

  const listenerOptions: CreateAgentEventListenerOptions = {
    metadata,
    events: dependencies.events,
    committer: runtime.committer,
    ids: dependencies.ids,
    clock: dependencies.clock,
    observer,
    runtime,
    onAgentEnd: () => releaseActiveScope(contextDependencies, runtime),
  };
  const settlement = createFinalReplySettlement(runtime, listenerOptions);

  const agent = new Agent({
    initialState: {
      configuration: {
        systemPrompt: '',
        model: metadata.model,
        thinkingLevel: metadata.model.reasoning ? 'high' : 'minimal',
        tools: [],
      },
      messages: [{
        role: 'user',
        content: [...input.input.modelContent],
        timestamp: timestampFrom(metadata.createdAt),
      }],
    },
    stream: createStreamAdapter(dependencies, metadata),
    context: contextProvider,
    policy: toAgentPolicy(dependencies.policy),
    settlement,
  });
  agent.subscribe(createAgentEventListener(listenerOptions));

  return {
    agent,
    userMessage: saved.message,
    userEntry: saved.entry,
    execute: () => executeAgentExecution(agent, runtime, contextDependencies, metadata),
  };
}

async function executeAgentExecution(
  agent: Agent,
  runtime: ExecutionRuntime,
  contextDependencies: Parameters<typeof createContextAdapter>[0],
  metadata: ExecutionMetadata,
): Promise<ExecutionOutcome> {
  runtime.observer.start();
  let final: ExecutionOutcome | undefined;
  try {
    const result = await agent.continue({ executionId: metadata.executionId });
    final = outcomeFromResult(result, runtime);
    return final;
  } catch (error) {
    final = {
      status: 'failed',
      failure: internalFailure(error),
    };
    return final;
  } finally {
    releaseActiveScope(contextDependencies, runtime);
    runtime.observer.end(
      final?.status === 'completed' ? 'ok'
        : final?.status === 'cancelled' ? 'cancelled'
        : 'error',
    );
  }
}

/**
 * The Agent settlement seam: every completed, failed and cancelled candidate
 * commits exactly one final Assistant Reply inside the settling phase. A failed
 * commit throws SessionCommitError so Agent Core fixes one session-failed result.
 */
function createFinalReplySettlement(
  runtime: ExecutionRuntime,
  options: CreateAgentEventListenerOptions,
): AgentSettlement {
  return async (result) => {
    const turn = runtime.pendingFinalTurn ?? runtime.activeTurn;
    const message = result.status === 'completed'
      ? result.finalMessage
      : result.status === 'cancelled'
        ? lastAssistant(result.newMessages)
        : undefined;
    const failure = result.status === 'failed' ? outcomeFromFailedError(result.error) : undefined;
    if (failure?.code === 'session_failed') {
      // The Session itself failed: no reply can be committed, and the execution
      // outcome must stay owned by Session without a fabricated terminal reply.
      return;
    }
    const reply = await runtime.committer.commitAssistantReply({
      sessionId: options.metadata.sessionId,
      executionId: options.metadata.executionId,
      status: result.status,
      content: result.status === 'completed'
        ? toSettlementContent(message)
        : result.status === 'cancelled' && message
          ? toSettlementContent(message)
          : [],
      reasonCode: result.status === 'completed'
        ? 'normal_completion'
        : result.status === 'cancelled'
          ? 'user_cancelled'
          : failureReason(failure!.code),
      ...(turn ? { messageId: turn.messageId } : {}),
      ...(message ? { metadata: assistantMetadata(message) } : {}),
      completedAt: options.clock.now(),
    });
    if (reply.status === 'failed') {
      if (turn?.messageStarted && !turn.messageEnded && turn.assistant) {
        publishMessageEnded(turn.assistant, turn.messageId, options);
        turn.messageEnded = true;
      }
      if (turn) {
        publishTurnEndedProjection(options, {
          stopReason: 'error',
          messageId: turn.messageId,
          toolCallIds: turn.assistant ? toolCallIdsOf(turn.assistant) : [],
        });
      }
      throw new SessionCommitError(reply.failure.message);
    }
    runtime.assistantMessageId = reply.messageId;
    if (!turn?.messageStarted) {
      emitMessageStarted(options, reply.messageId);
    }
    emitMessageEnded(options, reply.messageId, settlementText(result));
    if (turn) {
      publishTurnEndedProjection(options, {
        stopReason: result.status === 'completed' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'error',
        messageId: reply.messageId,
        toolCallIds: message ? toolCallIdsOf(message) : [],
      });
    }
    runtime.pendingFinalTurn = undefined;
    runtime.activeTurn = undefined;
  };
}

function outcomeFromResult(result: AgentExecutionResult, runtime: ExecutionRuntime): ExecutionOutcome {
  if (result.status === 'completed') {
    const assistantMessageId = runtime.assistantMessageId;
    if (!assistantMessageId) {
      return {
        status: 'failed',
        failure: {
          code: 'internal_error',
          message: 'Execution completed without a settled Assistant Reply.',
          retryable: false,
          cause: { owner: 'discovery-agent', code: 'assistant_reply_missing' },
        },
      };
    }
    return { status: 'completed', assistantMessageId };
  }
  if (result.status === 'cancelled') return { status: 'cancelled' };
  return { status: 'failed', failure: outcomeFromFailedError(result.error) };
}

function outcomeFromFailedError(error: import('@megumi/agent').AgentError): ExecutionFailure {
  if (error.code === 'event_listener_failed' && error.cause instanceof SessionCommitError) {
    return {
      code: 'session_failed',
      message: error.cause.message,
      retryable: false,
      cause: { owner: 'session', code: 'session_failed' },
    };
  }
  return agentFailure(error);
}

function agentFailure(error: import('@megumi/agent').AgentError): ExecutionFailure {
  const cause = agentCause(error.cause);
  if (error.code === 'context_failed') {
    return { code: 'context_failed', message: error.message, retryable: error.retryable, cause };
  }
  if (error.code === 'model_call_failed') {
    return {
      code: 'model_call_failed',
      message: error.message,
      retryable: error.retryable,
      cause: cause ?? { owner: 'ai', code: 'model_call_failed' },
    };
  }
  if (error.code === 'tool_system_failed') {
    return {
      code: cause?.owner === 'permissions' ? 'permission_failed' : 'tool_system_failed',
      message: error.message,
      retryable: error.retryable,
      cause: cause ?? { owner: 'tools', code: 'tool_system_failed' },
    };
  }
  if (error.code === 'execution_limit_reached') {
    return {
      code: 'loop_limit_exceeded',
      message: error.message,
      retryable: false,
      cause: { owner: 'discovery-agent', code: 'loop_limit_exceeded' },
    };
  }
  return {
    code: 'internal_error',
    message: error.message,
    retryable: false,
    cause: cause ?? { owner: 'discovery-agent', code: error.code },
  };
}

function agentCause(value: unknown): ExecutionFailure['cause'] {
  if (!value || typeof value !== 'object') return undefined;
  const owner = (value as { owner?: unknown }).owner;
  const code = (value as { code?: unknown }).code;
  const owners: NonNullable<ExecutionFailure['cause']>['owner'][] = [
    'agent', 'ai', 'context', 'permissions', 'tools', 'session', 'skills', 'workspace', 'instructions', 'discovery-agent',
  ];
  return typeof owner === 'string' && owners.includes(owner as NonNullable<ExecutionFailure['cause']>['owner']) && typeof code === 'string'
    ? { owner: owner as NonNullable<ExecutionFailure['cause']>['owner'], code }
    : undefined;
}

function createStreamAdapter(
  dependencies: ExecuteAgentDependencies,
  metadata: ExecutionMetadata,
): AgentStreamFunction {
  return async (model, context, options) => {
    const source = await dependencies.models.streamSimple(model, context, {
      ...options,
      ...(model.reasoning && options.reasoning ? { reasoning: options.reasoning } : {}),
      maxRetries: dependencies.policy.providerRequestMaxRetries,
      maxRetryDelayMs: dependencies.policy.providerRequestMaxRetryDelayMs,
    });
    const wrapped = createAssistantMessageEventStream();
    void pumpStream(source, wrapped, metadata.model);
    return wrapped;
  };
}

async function pumpStream(
  source: AssistantMessageEventStream,
  target: AssistantMessageEventStream,
  model: ExecutionMetadata['model'],
): Promise<void> {
  let terminal: AssistantMessage | undefined;
  try {
    for await (const event of source) {
      target.push(event);
      if (event.type === 'done') terminal = event.message;
      if (event.type === 'error') terminal = event.error;
    }
  } catch (error) {
    terminal = failedAssistantMessage(model, error instanceof Error ? error.message : 'Model stream failed.');
    target.push({ type: 'error', reason: 'error', error: terminal });
  } finally {
    target.end(terminal);
  }
}

function toAgentPolicy(policy: DiscoveryAgentPolicy): Partial<AgentPolicy> {
  return {
    maxModelCalls: policy.maxModelCallsPerExecution,
    maxModelCallAttempts: policy.maxModelCallAttempts,
    maxToolRounds: policy.maxToolRoundsPerExecution,
    maxToolCalls: policy.maxToolCallsPerExecution,
    maxToolCallsPerModelCall: policy.maxToolCallsPerModelCall,
    maxConcurrentToolCalls: policy.maxConcurrentToolExecutions,
    modelCallTimeoutMs: policy.modelCallTimeoutMs,
    toolCallTimeoutMs: policy.toolExecutionTimeoutMs,
    modelRetryDelayMs: policy.modelRetryDelayMs,
    maxContextOverflowRecoveries: policy.maxContextOverflowRecoveries,
  };
}

function failureReason(code: ExecutionFailure['code']): import('@megumi/session').AssistantReplyReasonCode {
  if (
    code === 'session_failed'
    || code === 'context_failed'
    || code === 'model_call_failed'
    || code === 'loop_limit_exceeded'
    || code === 'runtime_protocol_violation'
  ) return code;
  if (code === 'permission_failed') return 'approval_failed';
  if (code === 'tool_system_failed') return 'tool_call_failed';
  return 'internal_error';
}

function toSettlementContent(message: AssistantMessage | undefined): import('@megumi/session').SessionAssistantContent[] {
  return message ? message.content.map((block) => {
    if (block.type === 'text') return { type: 'text' as const, text: block.text };
    if (block.type === 'thinking') return { type: 'thinking' as const, thinking: block.thinking };
    return {
      type: 'toolCall' as const,
      id: block.id,
      name: block.name,
      arguments: block.arguments as Record<string, unknown>,
    };
  }) : [];
}

function settlementText(result: AgentExecutionResult): string {
  if (result.status === 'completed') {
    return result.finalMessage.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
  const partial = lastAssistant(result.newMessages);
  return partial
    ? partial.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
    : '';
}

function assistantMetadata(message: AssistantMessage): AssistantReplyMetadata {
  return {
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...(message.responseModel ? { response_model: message.responseModel } : {}),
    ...(message.responseId ? { response_id: message.responseId } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.errorMessage ? { error_message: message.errorMessage } : {}),
  };
}

function lastAssistant(messages: readonly AgentMessage[]): AssistantMessage | undefined {
  return [...messages].reverse().find((message): message is AssistantMessage => message.role === 'assistant');
}

function toolCallIdsOf(message: AssistantMessage): string[] {
  return message.content.filter((block) => block.type === 'toolCall').map((block) => block.id);
}

function timestampFrom(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function internalFailure(error: unknown): ExecutionFailure {
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'Execution failed unexpectedly.',
    retryable: false,
    cause: { owner: 'discovery-agent', code: 'agent_execution_threw' },
  };
}

function failedAssistantMessage(
  model: ExecutionMetadata['model'],
  message: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now(),
  };
}

function emitMessageStarted(options: CreateAgentEventListenerOptions, messageId: string): void {
  try {
    options.events.publish({
      type: 'message.started',
      payload: { role: 'assistant', messageId },
      sessionId: options.metadata.sessionId,
      executionId: options.metadata.executionId,
    });
  } catch {
    // Runtime Events are best-effort and never own the outcome.
  }
}

function emitMessageEnded(options: CreateAgentEventListenerOptions, messageId: string, content: string): void {
  try {
    options.events.publish({
      type: 'message.ended',
      payload: { role: 'assistant', messageId, content },
      sessionId: options.metadata.sessionId,
      executionId: options.metadata.executionId,
    });
  } catch {
    // Runtime Events are best-effort and never own the outcome.
  }
}
