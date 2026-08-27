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
} from '@megumi/agent-core';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Models,
  type ProviderExchange,
} from '@megumi/ai';
import { materializeRecommendationReference, type ContextCapabilities } from '@megumi/context';
import type { EventBus } from '@megumi/events';
import type { UserInput } from '@megumi/input';
import type {
  Observability,
  OperationCompletion,
  StructuredRuntimeLogger,
} from '@megumi/observability';
import { createContentDigest } from '@megumi/observability';
import type { Permissions } from '@megumi/permissions';
import type { SessionHistory } from '@megumi/session';
import type { Tools } from '@megumi/tools';
import type {
  LaunchedAgentExecution,
  LaunchCandidateSupplyExecutionInput,
  LaunchDailyRecommendationExecutionInput,
  LaunchAgentExecutionInput,
} from './agent-executions';
import type {
  ConversationExecutionMetadata,
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
  publishMessageEnded,
  publishTurnEndedProjection,
  type CreateAgentEventListenerOptions,
  type ExecutionProjectionRuntime,
} from './execution-projection';
import {
  createSessionMessageCommitter,
  SessionCommitError,
  type AssistantReplyMetadata,
  type SessionMessageCommitter,
} from './session-settlement';
import { createAgentTool, createUnprotectedAgentTool } from './tool-adapter';

export interface AgentExecutionPolicy {
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
    'bindExecution'
  >;
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly session: Pick<
    SessionHistory,
    'saveUserMessage' | 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'
  >;
  readonly events: EventBus;
  readonly observability?: Observability;
  readonly runtimeLogger?: Pick<StructuredRuntimeLogger, 'write'>;
  readonly ids: {
    createModelCallId(): string;
    createToolExecutionId(): string;
    createApprovalId(): string;
    createSessionMessageId(): string;
  };
  readonly clock: ExecutionClock;
  readonly policy: AgentExecutionPolicy;
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
  readonly modelPumps: Set<Promise<void>>;
  assistantMessageId?: string;
}

interface ModelTraceRuntime extends ContextAdapterRuntime {
  readonly modelPumps: Set<Promise<void>>;
}

export async function launchAgentExecution(
  input: LaunchAgentExecutionInput,
  dependencies: ExecuteAgentDependencies,
): Promise<LaunchedAgentExecution> {
  if (input.kind !== 'conversation') {
    return launchBackgroundExecution(input, dependencies);
  }
  const { metadata } = input;
  const referenceContent = input.recommendationReference
    ? [input.recommendationReference]
    : [];
  const referenceModelContent = input.recommendationReference
    ? [materializeRecommendationReference(input.recommendationReference)]
    : [];

  // 1. The User Message commits before the Agent exists; failure fails the start.
  const userMessageRequest = {
    message_id: metadata.userMessageId,
    session_id: metadata.sessionId,
    execution_id: metadata.executionId,
    display_content: [...referenceContent, ...input.input.displayContent],
    model_content: [...referenceContent, ...input.input.modelContent],
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
  };
  const saved = await observeSessionMessageCommit(
    dependencies.observability,
    {
      requestId: metadata.requestId,
      executionId: metadata.executionId,
      sessionId: metadata.sessionId,
      messageId: metadata.userMessageId,
      workspaceId: metadata.workspaceId,
      ...contentDigestCorrelation({
        displayContent: userMessageRequest.display_content,
        modelContent: userMessageRequest.model_content,
      }),
    },
    () => dependencies.session.saveUserMessage(userMessageRequest),
  );
  if (saved.status === 'failed') {
    throw new LaunchExecutionError({
      code: 'session_failed',
      message: saved.failure.message,
      retryable: false,
      cause: { owner: 'session', code: saved.failure.code },
    });
  }

  // 2. Build the per-execution runtime and its adapters.
  const runtime: ExecutionRuntime = {
    toolRequests: new Map(),
    toolSystemFailures: new Map(),
    modelPumps: new Set(),
    committer: createSessionMessageCommitter({
      userEntry: saved.entry,
      session: dependencies.session,
      ids: dependencies.ids,
      ...(dependencies.observability ? { observability: dependencies.observability } : {}),
    }),
  };

  const toolExecutionResult = dependencies.tools.bindExecution({
    executionId: metadata.executionId,
    subject: {
      kind: 'session',
      sessionId: metadata.sessionId,
      workspaceId: metadata.workspaceId,
    },
    toolGroupId: 'conversation',
  });
  if (toolExecutionResult.status === 'failed') {
    throw new LaunchExecutionError({
      code: 'tool_system_failed',
      message: toolExecutionResult.failure.message,
      retryable: true,
      cause: { owner: 'tools', code: toolExecutionResult.failure.code },
    });
  }
  const toolExecution = toolExecutionResult.binding;

  const toolAdapter = createAgentTool({
    metadata,
    permissions: dependencies.permissions,
    ids: dependencies.ids,
    clock: dependencies.clock,
    events: dependencies.events,
    awaitApproval: input.awaitApproval,
    toolSystemFailures: runtime.toolSystemFailures,
    ...(dependencies.observability ? { observability: dependencies.observability } : {}),
  });
  const contextDependencies = {
    metadata,
    userInput: input.input,
    context: dependencies.context,
    toolExecution,
    ids: dependencies.ids,
    ...(dependencies.runtimeLogger ? { runtimeLogger: dependencies.runtimeLogger } : {}),
    createAgentTool: toolAdapter,
  };
  const contextProvider = createContextAdapter(contextDependencies, runtime);

  const listenerOptions: CreateAgentEventListenerOptions = {
    metadata,
    events: dependencies.events,
    committer: runtime.committer,
    ids: dependencies.ids,
    clock: dependencies.clock,
    runtime,
    onAgentEnd: () => {
      releaseActiveScope(contextDependencies, runtime);
      toolExecution.close();
    },
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
        content: [...referenceModelContent, ...input.input.modelContent],
        timestamp: timestampFrom(metadata.createdAt),
      }],
    },
    stream: createStreamAdapter(dependencies, metadata, runtime),
    context: contextProvider,
    policy: toAgentPolicy(dependencies.policy),
    settlement,
  });
  agent.subscribe(createAgentEventListener(listenerOptions));

  return {
    agent,
    userMessage: saved.message,
    userEntry: saved.entry,
    execute: () => observeAgentExecution(
      dependencies.observability,
      metadata,
      () => executeAgentExecution(agent, runtime, contextDependencies, metadata, toolExecution),
    ),
  };
}

async function launchBackgroundExecution(
  input: LaunchDailyRecommendationExecutionInput | LaunchCandidateSupplyExecutionInput,
  dependencies: ExecuteAgentDependencies,
): Promise<LaunchedAgentExecution> {
  const { metadata } = input;
  const runtime: ModelTraceRuntime = { modelPumps: new Set() };
  const toolExecutionResult = dependencies.tools.bindExecution({
    executionId: metadata.executionId,
    subject: { kind: 'background' },
    toolGroupId: input.kind,
  });
  if (toolExecutionResult.status === 'failed') {
    throw new LaunchExecutionError({
      code: 'tool_system_failed',
      message: toolExecutionResult.failure.message,
      retryable: true,
      cause: { owner: 'tools', code: toolExecutionResult.failure.code },
    });
  }
  const toolExecution = toolExecutionResult.binding;
  const contextDependencies = {
    metadata,
    runContext: input.runContext,
    context: dependencies.context,
    toolExecution,
    ids: dependencies.ids,
    ...(dependencies.runtimeLogger ? { runtimeLogger: dependencies.runtimeLogger } : {}),
    createAgentTool: (definition: import('@megumi/tools').ToolDefinition, scope: import('./context-adapter').ToolScope) => (
      createUnprotectedAgentTool(definition, scope.binding, {
        metadata,
        ...(dependencies.observability ? { observability: dependencies.observability } : {}),
      })
    ),
  };
  const contextProvider = createContextAdapter(contextDependencies, runtime);
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
        content: input.kind === 'daily_recommendation'
          ? '开始本次 Daily Recommendation 执行。'
          : '开始本次 Candidate Supply 执行。',
        timestamp: timestampFrom(metadata.createdAt),
      }],
    },
    stream: createStreamAdapter(dependencies, metadata, runtime),
    context: contextProvider,
    policy: toAgentPolicy(dependencies.policy),
  });

  return {
    agent,
    execute: () => observeAgentExecution(dependencies.observability, metadata, async () => {
      let outcome: ExecutionOutcome | undefined;
      try {
        const result = await agent.continue({ executionId: metadata.executionId });
        outcome = result.status === 'completed'
          ? { status: 'completed' }
          : result.status === 'cancelled'
            ? { status: 'cancelled' }
            : { status: 'failed', failure: outcomeFromFailedError(result.error) };
        return outcome;
      } catch (error) {
        outcome = { status: 'failed', failure: internalFailure(error) };
        return outcome;
      } finally {
        await drainModelPumps(runtime);
        releaseActiveScope(contextDependencies, runtime);
        toolExecution.close();
      }
    }),
  };
}

async function executeAgentExecution(
  agent: Agent,
  runtime: ExecutionRuntime,
  contextDependencies: Parameters<typeof createContextAdapter>[0],
  metadata: ConversationExecutionMetadata,
  toolExecution: import('@megumi/tools').ToolExecutionBinding,
): Promise<ExecutionOutcome> {
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
    await drainModelPumps(runtime);
    releaseActiveScope(contextDependencies, runtime);
    toolExecution.close();
  }
}

/** Keeps the real Agent Promise single-shot even if an injected diagnostic adapter fails. */
async function observeAgentExecution(
  observability: Observability | undefined,
  metadata: ExecutionMetadata,
  operation: () => Promise<ExecutionOutcome>,
): Promise<ExecutionOutcome> {
  let operationPromise: Promise<ExecutionOutcome> | undefined;
  const runOnce = (): Promise<ExecutionOutcome> => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name: 'agent.execution',
      correlation: executionCorrelation(metadata),
      classifyResult: classifyExecutionOutcome,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function executionCorrelation(metadata: ExecutionMetadata) {
  return {
    requestId: metadata.requestId,
    executionId: metadata.executionId,
    ...(metadata.kind === 'conversation'
      ? { sessionId: metadata.sessionId, workspaceId: metadata.workspaceId }
      : metadata.kind === 'daily_recommendation'
        ? { batchId: metadata.batchId }
        : {}),
  };
}

function classifyExecutionOutcome(outcome: ExecutionOutcome): OperationCompletion {
  if (outcome.status === 'completed') return { outcome: { status: 'ok' } };
  if (outcome.status === 'cancelled') return { outcome: { status: 'cancelled' } };
  return {
    outcome: {
      status: 'error',
      code: outcome.failure.code,
      message: outcome.failure.message,
      retryable: outcome.failure.retryable,
    },
  };
}

function contentDigestCorrelation(value: unknown): { readonly contentDigest?: string } {
  const contentDigest = createContentDigest(value);
  return contentDigest ? { contentDigest } : {};
}

interface SessionMessageSaveResult {
  readonly status: 'saved' | 'failed';
  readonly failure?: { readonly code: string; readonly message: string };
}

/** Keeps the actual User Message save single-shot when diagnostics are unavailable. */
async function observeSessionMessageCommit<T extends SessionMessageSaveResult>(
  observability: Observability | undefined,
  correlation: Parameters<Observability['withSpan']>[0]['correlation'],
  operation: () => T | Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> => {
    operationPromise ??= Promise.resolve().then(operation);
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name: 'session.message.commit',
      ...(correlation ? { correlation } : {}),
      classifyResult: classifySessionMessageSave,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifySessionMessageSave(result: SessionMessageSaveResult): OperationCompletion {
  if (result.status === 'saved') return { outcome: { status: 'ok', code: 'saved' } };
  return {
    outcome: {
      status: 'error',
      code: result.failure?.code ?? 'session_commit_failed',
      message: result.failure?.message ?? 'Session message commit failed.',
    },
  };
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

function outcomeFromFailedError(error: import('@megumi/agent-core').AgentError): ExecutionFailure {
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

function agentFailure(error: import('@megumi/agent-core').AgentError): ExecutionFailure {
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
  runtime: ModelTraceRuntime,
): AgentStreamFunction {
  return (model, context, options) => {
    const wrapped = createAssistantMessageEventStream();
    let tracked: Promise<void>;
    tracked = observeModelCall(
      dependencies,
      metadata,
      runtime.activeScope?.modelCallId,
      model,
      context,
      options,
      wrapped,
    ).finally(() => { runtime.modelPumps.delete(tracked); });
    runtime.modelPumps.add(tracked);
    return wrapped;
  };
}

async function observeModelCall(
  dependencies: ExecuteAgentDependencies,
  metadata: ExecutionMetadata,
  modelCallId: string | undefined,
  model: Parameters<AgentStreamFunction>[0],
  context: Parameters<AgentStreamFunction>[1],
  options: Parameters<AgentStreamFunction>[2],
  target: AssistantMessageEventStream,
): Promise<void> {
  const operation = async (): Promise<AssistantMessage | undefined> => {
    safeRecordContent(dependencies.observability, {
      kind: 'model.request',
      value: {
        model: {
          id: model.id,
          api: model.api,
          provider: model.provider,
          reasoning: model.reasoning,
        },
        context: modelRequestContext(context),
        options: {
          ...(model.reasoning && options.reasoning ? { reasoning: options.reasoning } : {}),
          maxRetries: dependencies.policy.providerRequestMaxRetries,
          maxRetryDelayMs: dependencies.policy.providerRequestMaxRetryDelayMs,
        },
      },
      correlation: modelCallCorrelation(metadata, modelCallId),
    });
    const source = await dependencies.models.streamSimple(model, context, {
      ...options,
      ...(model.reasoning && options.reasoning ? { reasoning: options.reasoning } : {}),
      maxRetries: dependencies.policy.providerRequestMaxRetries,
      maxRetryDelayMs: dependencies.policy.providerRequestMaxRetryDelayMs,
      onProviderExchange: (exchange) => recordProviderExchange(
        dependencies.observability,
        metadata,
        modelCallId,
        exchange,
      ),
    });
    const terminal = await pumpStream(source, target, metadata.model);
    if (terminal) {
      safeRecordContent(dependencies.observability, {
        kind: 'model.response',
        value: terminal,
        correlation: modelCallCorrelation(metadata, modelCallId),
      });
    }
    return terminal;
  };
  let operationPromise: Promise<AssistantMessage | undefined> | undefined;
  const runOnce = (): Promise<AssistantMessage | undefined> => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!dependencies.observability) {
    await runOnce();
    return;
  }
  try {
    await dependencies.observability.withSpan({
      name: 'model.call',
      correlation: modelCallCorrelation(metadata, modelCallId),
      classifyResult: classifyModelResponse,
    }, runOnce);
  } catch {
    await runOnce();
  }
}

/** Removes Execution-only Tool callbacks from the provider-neutral Model request snapshot. */
function modelRequestContext(context: Parameters<AgentStreamFunction>[1]) {
  return {
    ...(context.systemPrompt === undefined ? {} : { systemPrompt: context.systemPrompt }),
    messages: context.messages,
    ...(context.tools === undefined ? {} : {
      tools: context.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(tool.constrainedSampling === undefined
          ? {}
          : { constrainedSampling: tool.constrainedSampling }),
      })),
    }),
  };
}

function recordProviderExchange(
  observability: Observability | undefined,
  metadata: ExecutionMetadata,
  modelCallId: string | undefined,
  exchange: ProviderExchange,
): void {
  const correlation = {
    ...modelCallCorrelation(metadata, modelCallId),
    providerAttempt: exchange.type === 'retry_scheduled'
      ? exchange.currentAttempt
      : exchange.attempt,
  };
  if (exchange.type === 'request') {
    safeRecordContent(observability, {
      kind: 'model.provider_request',
      value: exchange.payload,
      correlation,
    });
    return;
  }
  if (exchange.type === 'response') {
    safeRecordContent(observability, {
      kind: 'model.provider_response',
      value: exchange.payload,
      correlation,
    });
    return;
  }
  if (exchange.type === 'output_started') {
    safeRecordEvent(observability, {
      type: 'model.output.started',
      providerAttempt: exchange.attempt,
    });
    return;
  }
  if (exchange.type === 'retry_scheduled') {
    safeRecordEvent(observability, {
      type: 'model.retry.scheduled',
      currentAttempt: exchange.currentAttempt,
      nextAttempt: exchange.nextAttempt,
      reasonCode: exchange.reasonCode,
    });
    return;
  }
  if (exchange.partialResponse !== undefined) {
    safeRecordContent(observability, {
      kind: 'model.provider_response',
      value: exchange.partialResponse,
      correlation,
    });
  }
  safeRecordEvent(observability, {
    type: 'model.stream.interrupted',
    providerAttempt: exchange.attempt,
    reasonCode: exchange.reasonCode,
  });
}

function modelCallCorrelation(metadata: ExecutionMetadata, modelCallId: string | undefined) {
  return {
    ...executionCorrelation(metadata),
    ...(modelCallId ? { modelCallId } : {}),
  };
}

function classifyModelResponse(response: AssistantMessage | undefined): OperationCompletion {
  if (!response) {
    return {
      outcome: {
        status: 'error',
        code: 'model_stream_missing_terminal',
        message: 'Model stream ended without a terminal response.',
      },
    };
  }
  if (response.stopReason === 'aborted') {
    return { outcome: { status: 'cancelled', code: 'aborted', message: response.errorMessage } };
  }
  if (response.stopReason === 'error') {
    return {
      outcome: {
        status: 'error',
        code: 'model_call_failed',
        message: response.errorMessage ?? 'Model call failed.',
      },
    };
  }
  return { outcome: { status: 'ok', code: response.stopReason } };
}

function safeRecordContent(
  observability: Observability | undefined,
  input: Parameters<Observability['recordContent']>[0],
): void {
  try {
    observability?.recordContent(input);
  } catch {
    // Capturing diagnostics cannot alter the Model stream.
  }
}

function safeRecordEvent(
  observability: Observability | undefined,
  event: Parameters<Observability['recordEvent']>[0],
): void {
  try {
    observability?.recordEvent(event);
  } catch {
    // Event diagnostics cannot alter Provider retry or stream settlement.
  }
}

async function drainModelPumps(runtime: ModelTraceRuntime): Promise<void> {
  await Promise.allSettled([...runtime.modelPumps]);
}

async function pumpStream(
  source: AssistantMessageEventStream,
  target: AssistantMessageEventStream,
  model: ExecutionMetadata['model'],
): Promise<AssistantMessage | undefined> {
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
  return terminal;
}

function toAgentPolicy(policy: AgentExecutionPolicy): Partial<AgentPolicy> {
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
