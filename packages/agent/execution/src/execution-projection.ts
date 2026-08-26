/*
 * Projects Agent Events into Runtime Events and Session settlement facts.
 * It contains no Trace, Log, Measurement, or diagnostic lifecycle ownership.
 */
import type { AssistantMessage, ToolResultMessage } from '@megumi/ai';
import type { AgentError, AgentEvent, AgentEventListener } from '@megumi/agent-core';
import type { EventBus, EventPayloadByType, EventType } from '@megumi/events';
import type { SessionAssistantContent } from '@megumi/session';
import type {
  ConversationExecutionMetadata,
  ExecutionClock,
} from './execution-registry';
import type {
  AssistantReplyMetadata,
  SessionMessageCommitter,
  SessionToolResultCommit,
} from './session-settlement';
import { SessionCommitError } from './session-settlement';
import type { AgentToolResultDetails, AgentToolUpdateDetails } from './tool-adapter';
import type { ToolScope } from './context-adapter';

// ---------------------------------------------------------------------------
// Turn projection state
// ---------------------------------------------------------------------------

export interface TurnState {
  readonly modelCallId: string;
  readonly messageId: string;
  assistant?: AssistantMessage;
  messageStarted: boolean;
  attemptNumber: number;
  retryAttempts: number[];
  overflowRecoveryPending: boolean;
  messageEnded: boolean;
  lastThinking: string;
}

export interface ToolRequestState {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly modelCallId: string;
}

/** The shared per-execution projection state owned by the Execute Agent runtime. */
export interface ExecutionProjectionRuntime {
  activeScope?: ToolScope;
  activeTurn?: TurnState;
  pendingFinalTurn?: TurnState;
  readonly toolRequests: Map<string, ToolRequestState>;
  readonly toolSystemFailures: Map<string, AgentError>;
}

// ---------------------------------------------------------------------------
// AgentEvent listener
// ---------------------------------------------------------------------------

export interface CreateAgentEventListenerOptions {
  readonly metadata: ConversationExecutionMetadata;
  readonly events: EventBus;
  readonly committer: SessionMessageCommitter;
  readonly ids: { createSessionMessageId(): string };
  readonly clock: ExecutionClock;
  readonly runtime: ExecutionProjectionRuntime;
  /** Releases the active Tool Router scope; invoked on agent_end and settlement. */
  readonly onAgentEnd: () => void;
}

export function createAgentEventListener(options: CreateAgentEventListenerOptions): AgentEventListener {
  return async (event, signal) => {
    switch (event.type) {
      case 'turn_start': {
        const scope = options.runtime.activeScope;
        if (!scope) throw new Error('Turn started without a ModelCall Tool scope.');
        const turn: TurnState = {
          modelCallId: scope.modelCallId,
          messageId: options.ids.createSessionMessageId(),
          messageStarted: false,
          attemptNumber: 0,
          retryAttempts: [],
          overflowRecoveryPending: false,
          messageEnded: false,
          lastThinking: '',
        };
        options.runtime.activeTurn = turn;
        emitRuntime(options, 'turn.started', { messageId: turn.messageId });
        break;
      }
      case 'message_start':
        if (event.message.role === 'assistant' && options.runtime.activeTurn) {
          options.runtime.activeTurn.messageStarted = true;
          emitRuntime(options, 'message.started', {
            role: 'assistant',
            messageId: options.runtime.activeTurn.messageId,
          });
        }
        break;
      case 'message_update':
        publishAssistantProjection(event.message, options);
        break;
      case 'message_end':
        if (event.message.role === 'assistant' && options.runtime.activeTurn) {
          options.runtime.activeTurn.assistant = event.message;
          if (toolCallIds(event.message).length > 0) {
            publishMessageEnded(event.message, options.runtime.activeTurn.messageId, options);
            options.runtime.activeTurn.messageEnded = true;
          }
        }
        break;
      case 'model_call_attempt_started':
        recordAttemptStarted(event.attempt, options);
        break;
      case 'model_call_attempt_ended':
        recordAttemptEnded(event.attempt, event.outcome, event.error, options);
        break;
      case 'tool_execution_start': {
        const modelCallId = options.runtime.activeTurn?.modelCallId ?? options.runtime.activeScope?.modelCallId;
        if (!modelCallId) break;
        options.runtime.toolRequests.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          arguments: event.arguments,
          modelCallId,
        });
        emitRuntime(options, 'tool_execution.requested', {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: toRecord(event.arguments),
          modelCallId,
        });
        break;
      }
      case 'tool_execution_update':
        publishToolUpdate(event.toolCallId, event.update, options);
        break;
      case 'tool_execution_end':
        publishToolEnd(event.toolCallId, event.result, signal?.aborted === true, options);
        break;
      case 'turn_end':
        await settleTurn(event.message, event.toolResults, signal?.aborted === true, options);
        break;
      case 'agent_end': {
        const retryTurn = options.runtime.activeTurn ?? options.runtime.pendingFinalTurn;
        if (event.result.status !== 'completed' && retryTurn && retryTurn.retryAttempts.length > 0) {
          publishRetryFailed(
            retryTurn,
            event.result.status === 'failed' ? event.result.error.message : 'Model call was cancelled.',
            options,
          );
        }
        options.onAgentEnd();
        break;
      }
      default:
        break;
    }
  };
}

async function settleTurn(
  message: AssistantMessage,
  toolResults: readonly ToolResultMessage[],
  cancellationRequested: boolean,
  options: CreateAgentEventListenerOptions,
): Promise<void> {
  const runtime = options.runtime;
  const turn = runtime.activeTurn;
  if (!turn) throw new Error('Turn ended without an active Turn.');
  turn.assistant = message;
  try {
    if (toolResults.length === 0 && toolCallIds(message).length === 0) {
      runtime.pendingFinalTurn = turn;
      runtime.activeTurn = undefined;
      return;
    }
    if (toolResults.length === 0) {
      emitRuntime(options, 'turn.ended', {
        stopReason: 'error',
        messageId: turn.messageId,
        toolCallIds: toolCallIds(message),
      });
      runtime.activeTurn = undefined;
      return;
    }
    const response = await options.committer.commitModelResponse({
      sessionId: options.metadata.sessionId,
      executionId: options.metadata.executionId,
      messageId: turn.messageId,
      content: toAssistantContent(message),
      stopReason: message.stopReason,
      metadata: assistantMetadata(message),
      completedAt: options.clock.now(),
    });
    if (response.status === 'failed') throw new SessionCommitError(response.failure.message);
    if (!turn.messageEnded) publishMessageEnded(message, response.messageId, options);

    const commits = toolResults.map((result, callOrder) => toToolResultCommit(
      result,
      callOrder,
      options.clock.now(),
      cancellationRequested,
      runtime,
    ));
    const committed = await options.committer.commitToolResults({
      sessionId: options.metadata.sessionId,
      executionId: options.metadata.executionId,
      results: commits,
    });
    const commitById = new Map(commits.map((item) => [item.toolCallId, item]));
    for (const item of committed.items) {
      const commit = commitById.get(item.toolCallId);
      emitRuntime(options, 'message.started', {
        role: 'tool_result',
        messageId: item.messageId,
      });
      emitRuntime(options, 'message.ended', {
        role: 'tool_result',
        messageId: item.messageId,
        content: commit?.content ?? '',
      });
    }
    if (committed.status === 'failed') throw new SessionCommitError(committed.failure.message);
    emitRuntime(options, 'turn.ended', {
      stopReason: 'tool_calls',
      messageId: response.messageId,
      toolCallIds: toolResults.map((result) => result.toolCallId),
    });
    runtime.activeTurn = undefined;
  } catch (error) {
    if (!turn.messageEnded) {
      publishMessageEnded(message, turn.messageId, options);
      turn.messageEnded = true;
    }
    emitRuntime(options, 'turn.ended', {
      stopReason: 'error',
      messageId: turn.messageId,
      toolCallIds: toolCallIds(message),
    });
    runtime.activeTurn = undefined;
    throw error;
  }
}

function recordAttemptStarted(
  attemptNumber: number,
  options: CreateAgentEventListenerOptions,
): void {
  const turn = options.runtime.activeTurn;
  if (!turn) return;
  turn.attemptNumber += 1;
  if (attemptNumber > 1 && !turn.overflowRecoveryPending) {
    turn.retryAttempts.push(attemptNumber);
    emitRuntime(options, 'turn.retry.started', {
      attemptNumber,
      retryKind: 'model_call',
    });
  }
  turn.overflowRecoveryPending = false;
}

function recordAttemptEnded(
  attemptNumber: number,
  outcome: 'succeeded' | 'retrying' | 'failed' | 'cancelled',
  error: AgentError | undefined,
  options: CreateAgentEventListenerOptions,
): void {
  const turn = options.runtime.activeTurn;
  if (!turn || turn.attemptNumber !== attemptNumber) return;
  if (outcome === 'retrying' && !error) {
    // Context Overflow recovery is a real attempt boundary but never a retry.
    turn.overflowRecoveryPending = true;
  }
  if (turn.retryAttempts.length === 0) return;
  if (outcome === 'succeeded') publishRetryCompleted(turn, options);
  else if (outcome === 'failed' || outcome === 'cancelled') {
    publishRetryFailed(turn, error?.message ?? 'Model call failed.', options);
  }
}

function publishRetryCompleted(turn: TurnState, options: CreateAgentEventListenerOptions): void {
  for (const attemptNumber of turn.retryAttempts) {
    emitRuntime(options, 'turn.retry.completed', { attemptNumber });
  }
  turn.retryAttempts = [];
}

function publishRetryFailed(turn: TurnState, message: string, options: CreateAgentEventListenerOptions): void {
  for (const attemptNumber of turn.retryAttempts) {
    emitRuntime(options, 'turn.retry.failed', {
      attemptNumber,
      error: { message, code: 'model_call_failed' },
    });
  }
  turn.retryAttempts = [];
}

function publishAssistantProjection(
  message: AssistantMessage,
  options: CreateAgentEventListenerOptions,
): void {
  const turn = options.runtime.activeTurn;
  if (!turn) return;
  const content = toAssistantContent(message);
  const thinking = content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('');
  emitRuntime(options, 'message.update', {
    role: 'assistant',
    messageId: turn.messageId,
    content: assistantText(content),
  });
  if (thinking && thinking !== turn.lastThinking) {
    turn.lastThinking = thinking;
    emitRuntime(options, 'message.thinking.update', {
      messageId: turn.messageId,
      thinking,
    });
  }
}

function publishToolUpdate(
  toolCallId: string,
  update: { readonly details?: unknown },
  options: CreateAgentEventListenerOptions,
): void {
  const details = update.details as AgentToolUpdateDetails | undefined;
  if (!details) return;
  if (details.kind === 'execution_started') {
    emitRuntime(options, 'tool_execution.started', {
      toolCallId,
      toolName: details.toolName,
      args: toRecord(details.arguments),
      toolExecutionId: details.toolExecutionId,
    });
    return;
  }
  if (details.kind === 'output') {
    emitRuntime(options, 'tool_execution.update', {
      toolCallId,
      output: details.output,
    });
    return;
  }
  emitRuntime(options, 'tool_execution.plan_updated', {
    toolCallId,
    ...(details.notification.explanation ? { explanation: details.notification.explanation } : {}),
    plan: details.notification.plan.map((step) => ({ step: step.step, status: step.status })),
  });
}

function publishToolEnd(
  toolCallId: string,
  result: { readonly details?: unknown; readonly isError: boolean; readonly content: readonly { type: string; text?: string }[] },
  cancellationRequested: boolean,
  options: CreateAgentEventListenerOptions,
): void {
  const details = result.details as AgentToolResultDetails | undefined;
  if (!details) {
    const systemFailure = options.runtime.toolSystemFailures.get(toolCallId);
    if (cancellationRequested && !systemFailure) {
      emitRuntime(options, 'tool_execution.ended', {
        toolCallId,
        status: 'cancelled',
      });
      return;
    }
    emitRuntime(options, 'tool_execution.ended', {
      toolCallId,
      status: 'failed',
      error: {
        message: systemFailure?.message ?? toolResultText(result),
        code: systemFailure ? 'run_failed_before_tool_result' : 'tool_execution_failed',
      },
    });
    return;
  }
  if (details.status === 'success') {
    emitRuntime(options, 'tool_execution.ended', {
      toolCallId,
      ...(details.toolExecutionId ? { toolExecutionId: details.toolExecutionId } : {}),
      status: 'completed',
      result: details.content,
      ...(details.summary ? { summary: details.summary } : {}),
    });
    return;
  }
  if (details.status === 'permission_denied' || details.status === 'user_rejected') {
    emitRuntime(options, 'tool_execution.ended', {
      toolCallId,
      status: 'denied',
    });
    return;
  }
  if (details.status === 'cancelled') {
    emitRuntime(options, 'tool_execution.ended', {
      toolCallId,
      ...(details.toolExecutionId ? { toolExecutionId: details.toolExecutionId } : {}),
      status: 'cancelled',
    });
    return;
  }
  emitRuntime(options, 'tool_execution.ended', {
    toolCallId,
    ...(details.toolExecutionId ? { toolExecutionId: details.toolExecutionId } : {}),
    status: 'failed',
    error: {
      message: details.error?.message ?? details.content,
      ...(details.error?.code ? { code: details.error.code } : {}),
    },
  });
}

export function toToolResultCommit(
  result: ToolResultMessage,
  callOrder: number,
  fallbackCompletedAt: string,
  cancellationRequested: boolean,
  runtime: ExecutionProjectionRuntime,
): SessionToolResultCommit {
  const details = result.details as AgentToolResultDetails | undefined;
  const systemFailure = runtime.toolSystemFailures.get(result.toolCallId);
  const cancelledWithoutDetails = cancellationRequested && !details && !systemFailure;
  return {
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    callOrder,
    status: details?.status ?? (cancelledWithoutDetails ? 'cancelled' : 'failure'),
    ...(details?.error ? { error: details.error } : result.isError
      ? {
          error: {
            code: systemFailure
              ? 'run_failed_before_tool_result'
              : cancelledWithoutDetails
                ? 'tool_cancelled'
                : 'tool_execution_failed',
            message: systemFailure?.message ?? toolResultText(result),
          },
        }
      : {}),
    content: details?.content ?? toolResultText(result),
    completedAt: details?.completedAt ?? fallbackCompletedAt,
  };
}

export function publishMessageEnded(
  message: AssistantMessage,
  messageId: string,
  options: CreateAgentEventListenerOptions,
): void {
  emitRuntime(options, 'message.ended', {
    role: 'assistant',
    messageId,
    content: assistantText(toAssistantContent(message)),
  });
}

/** Publishes the turn.ended projection for settlement paths that bypass the turn listener. */
export function publishTurnEndedProjection(
  options: CreateAgentEventListenerOptions,
  input: {
    readonly stopReason: 'completed' | 'cancelled' | 'error' | 'tool_calls';
    readonly messageId: string;
    readonly toolCallIds: readonly string[];
  },
): void {
  emitRuntime(options, 'turn.ended', {
    stopReason: input.stopReason,
    messageId: input.messageId,
    toolCallIds: [...input.toolCallIds],
  });
}

export function toAssistantContent(message: AssistantMessage): SessionAssistantContent[] {
  return message.content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking };
    return {
      type: 'toolCall',
      id: block.id,
      name: block.name,
      arguments: block.arguments as Record<string, unknown>,
    };
  });
}

export function assistantMetadata(message: AssistantMessage): AssistantReplyMetadata {
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

export function assistantText(content: readonly SessionAssistantContent[]): string {
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

export function toolCallIds(message: AssistantMessage): string[] {
  return message.content.filter((block) => block.type === 'toolCall').map((block) => block.id);
}

export function toolResultText(result: { readonly content: readonly { type: string; text?: string }[] }): string {
  return result.content.flatMap((block) => block.type === 'text' && block.text ? [block.text] : []).join('\n');
}

function emitRuntime<TType extends EventType>(
  options: CreateAgentEventListenerOptions,
  type: TType,
  payload: EventPayloadByType[TType],
): void {
  try {
    options.events.publish({
      type,
      payload,
      sessionId: options.metadata.sessionId,
      executionId: options.metadata.executionId,
    });
  } catch {
    // Runtime Events are best-effort and never own the outcome.
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value) as Record<string, unknown>
    : {};
}
