/*
 * The single Agent execution loop: one runAgentLoop() call drives Context
 * builds, AI model streams, Tool Call batches, approval waits, Session
 * commits and the final Run outcome for one Run. The loop keeps no state
 * across calls: all tool batches, attempts, stream snapshots and observation
 * handles are local to this function invocation.
 */
import {
  isContextOverflow,
  isRetryableAssistantError,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
} from '@megumi/ai';
import type { EventBus, EventPayloadByType, EventType } from '@megumi/events';
import type { UserInput } from '@megumi/input';
import type { ObservabilityService, ObservabilitySpanName, SpanHandle, TraceHandle } from '@megumi/observability';
import type {
  ApprovalDecision,
  ApprovalSubject,
  PermissionDecision,
  PermissionMode,
  PermissionOperation,
  Permissions,
} from '@megumi/permissions';
import type { SessionAssistantContent, SessionEntry } from '@megumi/session';
import type { ToolIdentity, ToolInvocation, Tools, ToolExecutionAccess } from '@megumi/tools';
import type { ContextCapabilities, Prompt, RunContext } from '@megumi/context';
import type { RunApproval, RunClock, Run, RunFailure } from './run';
import type { RunPolicy } from './run-policy';
import type { ApprovalResolution } from './run-registry';

export interface AgentLoopInput {
  readonly run: Run;
  readonly userInput: UserInput;
  readonly userEntry: SessionEntry;
  /** Engine-owned status handle: the loop asks for waiting/running transitions. */
  readonly transitionRunStatus: (status: 'waiting' | 'running') => void;
  /** Engine-owned approval wait: settles exactly once via resolveApproval. */
  readonly awaitApproval: (request: { readonly approval: RunApproval }) => Promise<ApprovalResolution>;
  readonly signal: AbortSignal;
}

export interface AgentLoopDependencies {
  readonly models: Models;
  readonly context: ContextCapabilities;
  readonly tools: Pick<
    Tools,
    'resolveModelCallTools' | 'routeToolCall' | 'executeToolInvocation' | 'releaseModelCallTools'
  >;
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly session: Pick<
    import('@megumi/session').SessionHistory,
    'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'
  >;
  readonly events: EventBus;
  readonly observability?: ObservabilityService;
  /** The ID creation subset this loop needs; never the full public ids object. */
  readonly ids: {
    createModelCallId(): string;
    createToolExecutionId(): string;
    createRunApprovalId(): string;
    createSessionMessageId(): string;
  };
  readonly clock: RunClock;
  readonly policy: RunPolicy;
}

export type AgentLoopResult =
  | { readonly status: 'completed'; readonly assistantMessageId: string }
  | { readonly status: 'failed'; readonly failure: RunFailure }
  | { readonly status: 'cancelled' };

interface LoopRuntime {
  readonly run: Run;
  readonly userInput: UserInput;
  lastCommittedEntryId: string;
  modelCallCount: number;
  toolRoundCount: number;
  toolCallCount: number;
  activeModelMessageId?: string;
  activeAssistantText: string;
  activeThinking: string;
  trace?: TraceHandle;
  rootSpan?: SpanHandle;
  modelSpan?: SpanHandle;
  approvalSpan?: SpanHandle;
  readonly toolSpans: Map<string, SpanHandle>;
  observabilityEnded: boolean;
}

interface CompletedToolCall {
  readonly toolCallId: string;
  /** The logical ModelCall that produced this ToolCall. */
  readonly sourceModelCallId: string;
  readonly callOrder: number;
  readonly toolName: string;
  readonly input: unknown;
}

type ModelCallOutcome =
  | { readonly status: 'completed'; readonly message: AssistantMessage; readonly toolCalls: readonly CompletedToolCall[] }
  | { readonly status: 'failed'; readonly failure: RunFailure }
  | { readonly status: 'cancelled'; readonly partial: { readonly text: string; readonly thinking: string } };

type AttemptOutcome =
  | { readonly status: 'completed'; readonly message: AssistantMessage }
  | { readonly status: 'overflow'; readonly message: AssistantMessage }
  | { readonly status: 'failed'; readonly failure: RunFailure; readonly retryable: boolean }
  | { readonly status: 'aborted'; readonly partial: { readonly text: string; readonly thinking: string } };

interface ToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly callOrder: number;
  readonly status: 'success' | 'failure' | 'permission_denied' | 'user_rejected' | 'cancelled';
  readonly error?: { readonly code: string; readonly message: string };
  readonly content: string;
  readonly summary?: string;
  readonly completedAt: string;
}

export async function runAgentLoop(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
): Promise<AgentLoopResult> {
  const runtime: LoopRuntime = {
    run: input.run,
    userInput: input.userInput,
    lastCommittedEntryId: input.userEntry.entry_id,
    modelCallCount: 0,
    toolRoundCount: 0,
    toolCallCount: 0,
    activeAssistantText: '',
    activeThinking: '',
    toolSpans: new Map(),
    observabilityEnded: false,
  };
  startLoopObservability(dependencies, runtime);
  // A Run failure settles one terminal Assistant Reply with the failure reason
  // (session failures commit nothing; the Session owns the error already).
  const failRun = async (failure: RunFailure): Promise<AgentLoopResult> => {
    if (input.signal.aborted) return cancelledResult();
    if (failure.code !== 'session_failed') {
      const reply = dependencies.session.saveAssistantReply({
        message_id: dependencies.ids.createSessionMessageId(),
        session_id: input.run.sessionId,
        run_id: input.run.runId,
        parent_entry_id: runtime.lastCommittedEntryId,
        status: 'failed',
        content: [],
        reason_code: failureReason(failure),
        completed_at: dependencies.clock.now(),
      });
      if (reply.status === 'failed') return failedResult(sessionFailure(reply.failure.message));
      runtime.lastCommittedEntryId = reply.entry.entry_id;
    }
    return failedResult(failure);
  };
  try {
    if (input.signal.aborted) return cancelledResult();
    for (;;) {
      if (input.signal.aborted) return cancelledResult();
      if (runtime.modelCallCount >= dependencies.policy.maxModelCallsPerRun) {
        return await failRun(loopLimitFailure('ModelCall limit reached.'));
      }

      const outcome = await runTurn(input, dependencies, runtime, failRun);
      if (outcome === 'next') continue;
      return outcome;
    }
  } catch (error) {
    if (input.signal.aborted) return cancelledResult();
    if (error instanceof SessionCommitFailure) return failedResult(sessionFailure(error.message));
    return await failRun({
      code: 'internal_error',
      message: error instanceof Error ? error.message : 'Engine failed unexpectedly.',
      retryable: false,
      cause: { owner: 'engine', code: 'unexpected_exception' },
    });
  } finally {
    endLoopObservability(dependencies, runtime, 'ok');
  }
}

async function runTurn(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  failRun: (failure: RunFailure) => Promise<AgentLoopResult>,
): Promise<AgentLoopResult | 'next'> {
  const modelCallId = dependencies.ids.createModelCallId();
  const runContext: RunContext = {
    runId: input.run.runId,
    sessionId: input.run.sessionId,
    workspaceId: input.run.workspaceId,
    userInput: input.userInput,
    model: input.run.model,
  };
  let toolResolution;
  try {
    toolResolution = dependencies.tools.resolveModelCallTools({
      runId: input.run.runId,
      sessionId: input.run.sessionId,
      workspaceId: input.run.workspaceId,
      modelCallId,
    });
  } catch {
    return await failRun({
      code: 'context_failed',
      message: 'Tool registry is unavailable.',
      retryable: true,
      cause: { owner: 'tools', code: 'tool_registry_unavailable' },
    });
  }
  if (toolResolution.status === 'failed') {
    return await failRun({
      code: 'context_failed',
      message: toolResolution.failure.message,
      retryable: true,
      cause: { owner: 'tools', code: toolResolution.failure.code },
    });
  }

  try {
    const buildPrompt = async (): Promise<Prompt> => {
      const built = await dependencies.context.build({
        modelCallContext: { modelCallId, run: runContext, tools: toolResolution.definitions },
        signal: input.signal,
      });
      if (built.status === 'failed') {
        throw new ContextBuildFailure(built.failure.code, built.failure.message, built.failure.retryable);
      }
      return built.prompt;
    };
    let prompt: Prompt;
    try {
      prompt = await buildPrompt();
    } catch (error) {
      if (input.signal.aborted) {
        await commitCancelledReply(input, dependencies, runtime, { text: '', thinking: '' });
        return cancelledResult();
      }
      if (error instanceof ContextBuildFailure) {
        return await failRun({
          code: 'context_failed',
          message: error.message,
          retryable: error.retryable,
          cause: { owner: 'context', code: error.code },
        });
      }
      throw error;
    }

    // Cancellation may win during the build: converge without starting a Turn
    // or a ModelCall, but still settle the cancelled reply for the Run.
    if (input.signal.aborted) {
      await commitCancelledReply(input, dependencies, runtime, { text: '', thinking: '' });
      return cancelledResult();
    }

    // One message identity spans the whole streaming Turn and is reused when
    // the reply is stored.
    runtime.activeModelMessageId = dependencies.ids.createSessionMessageId();
    runtime.activeAssistantText = '';
    runtime.activeThinking = '';
    emitEvent(dependencies, runtime, 'turn.started', { messageId: runtime.activeModelMessageId });
    emitEvent(dependencies, runtime, 'message.started', {
      role: 'assistant',
      messageId: runtime.activeModelMessageId,
    });
    runtime.modelCallCount += 1;

    const modelSpan = startObservedSpan(dependencies, runtime, 'model.call');
    runtime.modelSpan = modelSpan;
    let modelOutcome: ModelCallOutcome;
    try {
      modelOutcome = await consumeModelCall(input, dependencies, runtime, modelCallId, buildPrompt, prompt);
    } finally {
      endObservedSpan(dependencies, modelSpan, input.signal.aborted ? 'cancelled' : 'ok');
      runtime.modelSpan = undefined;
    }

    if (modelOutcome.status === 'cancelled') {
      await commitCancelledReply(input, dependencies, runtime, modelOutcome.partial);
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'cancelled',
        messageId: runtime.activeModelMessageId ?? '',
        toolCallIds: [],
      });
      return cancelledResult();
    }
    if (modelOutcome.status === 'failed') {
      // A started message lifecycle always gets its closing event.
      emitEvent(dependencies, runtime, 'message.ended', {
        role: 'assistant',
        messageId: runtime.activeModelMessageId ?? '',
        content: runtime.activeAssistantText,
      });
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'error',
        messageId: runtime.activeModelMessageId ?? '',
        toolCallIds: [],
      });
      return await failRun(modelOutcome.failure);
    }

    const assistantContent = toAssistantContent(modelOutcome.message);
    const messageId = runtime.activeModelMessageId ?? dependencies.ids.createSessionMessageId();

    if (modelOutcome.toolCalls.length === 0) {
      const reply = dependencies.session.saveAssistantReply({
        message_id: messageId,
        session_id: input.run.sessionId,
        run_id: input.run.runId,
        parent_entry_id: runtime.lastCommittedEntryId,
        status: 'completed',
        content: assistantContent,
        reason_code: 'normal_completion',
        ...assistantMetadata(modelOutcome.message),
        completed_at: dependencies.clock.now(),
      });
      if (reply.status === 'failed') {
        return await failRun(sessionFailure(reply.failure.message));
      }
      runtime.lastCommittedEntryId = reply.entry.entry_id;
      emitEvent(dependencies, runtime, 'message.ended', {
        role: 'assistant',
        messageId: reply.message.message_id,
        content: assistantContent
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      });
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'completed',
        messageId: reply.message.message_id,
        toolCallIds: [],
      });
      return { status: 'completed', assistantMessageId: reply.message.message_id };
    }

    if (
      modelOutcome.toolCalls.length > dependencies.policy.maxToolCallsPerModelCall
      || runtime.toolCallCount + modelOutcome.toolCalls.length > dependencies.policy.maxToolCallsPerRun
    ) {
      return await failRun(loopLimitFailure('ToolCall limit reached.'));
    }
    if (runtime.toolRoundCount >= dependencies.policy.maxToolRoundsPerRun) {
      return await failRun(loopLimitFailure('Tool round limit reached.'));
    }

    const response = dependencies.session.saveModelResponse({
      message_id: messageId,
      session_id: input.run.sessionId,
      run_id: input.run.runId,
      parent_entry_id: runtime.lastCommittedEntryId,
      content: assistantContent,
      outcome_status: 'completed',
      stop_reason: modelOutcome.message.stopReason,
      ...assistantMetadata(modelOutcome.message),
      completed_at: dependencies.clock.now(),
    });
    if (response.status === 'failed') {
      return await failRun(sessionFailure(response.failure.message));
    }
    runtime.lastCommittedEntryId = response.entry.entry_id;
    emitEvent(dependencies, runtime, 'message.ended', {
      role: 'assistant',
      messageId: response.message.message_id,
      content: assistantContent
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
    });
    runtime.toolCallCount += modelOutcome.toolCalls.length;
    runtime.toolRoundCount += 1;

    for (const call of modelOutcome.toolCalls) {
      emitEvent(dependencies, runtime, 'tool_execution.requested', {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: toJsonValue(call.input) as Record<string, unknown>,
        modelCallId: call.sourceModelCallId,
      });
    }

    const batch = await executeToolCallBatch(input, dependencies, runtime, modelCallId, modelOutcome.toolCalls);
    if (batch === 'cancelled') {
      await commitCancelledReply(input, dependencies, runtime, {
        text: runtime.activeAssistantText,
        thinking: runtime.activeThinking,
      });
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'cancelled',
        messageId: messageId,
        toolCallIds: modelOutcome.toolCalls.map((call) => call.toolCallId),
      });
      return cancelledResult();
    }
    if (typeof batch === 'object') {
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'error',
        messageId: messageId,
        toolCallIds: modelOutcome.toolCalls.map((call) => call.toolCallId),
      });
      return await failRun(batch.failure);
    }
    emitEvent(dependencies, runtime, 'turn.ended', {
      stopReason: 'tool_calls',
      messageId: messageId,
      toolCallIds: modelOutcome.toolCalls.map((call) => call.toolCallId),
    });
    return 'next';
  } finally {
    dependencies.tools.releaseModelCallTools({ modelCallId });
  }
}

/**
 * Consumes the AI model stream directly: one attempt streams through
 * `event.partial` snapshots, and the terminal `result()` is the only settled
 * message. Context Overflow recovery and ModelCall Retry stay in this loop's
 * explicit control with the same logical identities.
 */
async function consumeModelCall(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  modelCallId: string,
  buildPrompt: () => Promise<Prompt>,
  initialPrompt: Prompt,
): Promise<ModelCallOutcome> {
  let prompt = initialPrompt;
  let attemptNumber = 1;
  let overflowRecoveries = 0;
  const retriedAttempts: number[] = [];

  /** Clears the projected text/thinking snapshots before a recoverable attempt. */
  const resetProjection = (): void => {
    runtime.activeAssistantText = '';
    runtime.activeThinking = '';
    emitEvent(dependencies, runtime, 'message.update', {
      role: 'assistant',
      messageId: runtime.activeModelMessageId ?? '',
      content: '',
    });
    emitEvent(dependencies, runtime, 'message.thinking.update', {
      messageId: runtime.activeModelMessageId ?? '',
      thinking: '',
    });
    recordObservedLog(dependencies, runtime, {
      level: 'info',
      event: 'model.call.stream_reset',
      attributes: { modelCallId, attemptNumber },
    });
  };

  const recoverOverflow = async (): Promise<ModelCallOutcome | 'recovered'> => {
    // A recoverable stream reset clears the projected text and thinking before
    // the next attempt; the same Turn, Message and ModelCall identities stay.
    resetProjection();
    const compacted = await dependencies.context.compact({
      sessionId: input.run.sessionId,
      workspaceId: input.run.workspaceId,
      model: input.run.model,
      trigger: 'overflow',
      // The current ModelCall Tool Definitions are already resolved; compaction
      // must not re-resolve them and the bus was injected at Context creation.
      tools: prompt.tools,
      signal: input.signal,
    });
    if (compacted.status !== 'compacted') {
      return {
        status: 'failed',
        failure: {
          code: 'context_failed',
          message: compacted.status === 'failed'
            ? compacted.failure.message
            : 'ModelCall overflowed and compaction had nothing to compact.',
          retryable: false,
          cause: { owner: 'context', code: compacted.status === 'failed' ? compacted.failure.code : 'compaction_failed' },
        },
      };
    }
    if (input.signal.aborted) {
      return { status: 'cancelled', partial: { text: runtime.activeAssistantText, thinking: runtime.activeThinking } };
    }
    try {
      prompt = await buildPrompt();
    } catch (error) {
      if (input.signal.aborted) {
        return { status: 'cancelled', partial: { text: runtime.activeAssistantText, thinking: runtime.activeThinking } };
      }
      if (error instanceof ContextBuildFailure) {
        return {
          status: 'failed',
          failure: {
            code: 'context_failed',
            message: error.message,
            retryable: error.retryable,
            cause: { owner: 'context', code: error.code },
          },
        };
      }
      throw error;
    }
    overflowRecoveries += 1;
    attemptNumber += 1;
    return 'recovered';
  };

  for (;;) {
    if (input.signal.aborted) {
      return { status: 'cancelled', partial: { text: runtime.activeAssistantText, thinking: runtime.activeThinking } };
    }
    const maxAttempts = dependencies.policy.maxModelCallAttempts + overflowRecoveries;
    recordObservedMeasurement(dependencies, runtime, {
      name: 'model.call.attempt',
      value: attemptNumber,
      unit: 'count',
      attributes: { modelCallId },
    });

    const attempt = await runStreamAttempt(input, dependencies, runtime, modelCallId, prompt, attemptNumber);

    if (attempt.status === 'completed') {
      if (isContextOverflow(attempt.message, input.run.model.contextWindow)) {
        // Compaction recoveries are bounded by the confirmed Engine Policy;
        // exhausting them ends the Run instead of compacting again.
        if (overflowRecoveries >= dependencies.policy.maxContextOverflowRecoveries) {
          return {
            status: 'failed',
            failure: {
              code: 'context_failed',
              message: 'ModelCall overflowed the Context Window even after compaction recovery.',
              retryable: false,
              cause: { owner: 'context', code: 'context_window_exceeded' },
            },
          };
        }
        const recovered = await recoverOverflow();
        if (recovered !== 'recovered') return recovered;
        continue;
      }
      const validated = validateCompletedResponse(modelCallId, attempt.message);
      if (validated.status === 'invalid') {
        if (validated.failure.retryable && attemptNumber < maxAttempts && !input.signal.aborted) {
          resetProjection();
          retriedAttempts.push(attemptNumber + 1);
          publishRetryStarted(dependencies, runtime, attemptNumber + 1, maxAttempts);
          await waitForRetry(dependencies.policy.modelRetryDelayMs, input.signal);
          attemptNumber += 1;
          continue;
        }
        publishRetryFailed(dependencies, runtime, retriedAttempts, validated.failure);
        return { status: 'failed', failure: modelCallFailure(validated.failure) };
      }
      publishRetryCompleted(dependencies, runtime, retriedAttempts);
      return {
        status: 'completed',
        message: attempt.message,
        toolCalls: validated.toolCalls,
      };
    }

    if (attempt.status === 'overflow') {
      // Compaction recoveries are bounded by the confirmed Engine Policy;
      // exhausting them ends the Run instead of compacting again.
      if (overflowRecoveries >= dependencies.policy.maxContextOverflowRecoveries) {
        return {
          status: 'failed',
          failure: {
            code: 'context_failed',
            message: 'ModelCall overflowed the Context Window even after compaction recovery.',
            retryable: false,
            cause: { owner: 'context', code: 'context_window_exceeded' },
          },
        };
      }
      const recovered = await recoverOverflow();
      if (recovered !== 'recovered') return recovered;
      continue;
    }

    if (attempt.status === 'failed') {
      if (attempt.retryable && attemptNumber < maxAttempts && !input.signal.aborted) {
        resetProjection();
        retriedAttempts.push(attemptNumber + 1);
        publishRetryStarted(dependencies, runtime, attemptNumber + 1, maxAttempts);
        await waitForRetry(dependencies.policy.modelRetryDelayMs, input.signal);
        attemptNumber += 1;
        continue;
      }
      publishRetryFailed(dependencies, runtime, retriedAttempts, {
        code: attempt.failure.code,
        message: attempt.failure.message,
      });
      return { status: 'failed', failure: attempt.failure };
    }

    return { status: 'cancelled', partial: attempt.partial };
  }
}

async function runStreamAttempt(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  modelCallId: string,
  prompt: Prompt,
  attemptNumber: number,
): Promise<AttemptOutcome> {
  const startedAt = dependencies.clock.now();
  let terminal: AssistantMessage | undefined;
  const stream = dependencies.models.streamSimple(input.run.model, {
    systemPrompt: prompt.systemPrompt,
    messages: [...prompt.messages],
    tools: [...prompt.tools],
  }, {
    signal: input.signal,
    sessionId: input.run.sessionId,
    timeoutMs: dependencies.policy.modelCallTimeoutMs,
    maxRetries: dependencies.policy.providerRequestMaxRetries,
    maxRetryDelayMs: dependencies.policy.providerRequestMaxRetryDelayMs,
  });

  try {
    for await (const event of stream) {
      if (event.type === 'start') continue;
      if (event.type === 'text_delta' || event.type === 'text_end') {
        const text = contentText(event.partial);
        runtime.activeAssistantText = text;
        if (runtime.activeModelMessageId) {
          // Full snapshot: consumers replace, never merge.
          emitEvent(dependencies, runtime, 'message.update', {
            role: 'assistant',
            messageId: runtime.activeModelMessageId,
            content: text,
          });
        }
        continue;
      }
      if (event.type === 'thinking_delta' || event.type === 'thinking_end') {
        const thinking = thinkingText(event.partial);
        runtime.activeThinking = thinking;
        if (runtime.activeModelMessageId) {
          // Full snapshot: consumers replace, never merge.
          emitEvent(dependencies, runtime, 'message.thinking.update', {
            messageId: runtime.activeModelMessageId,
            thinking,
          });
        }
        continue;
      }
      if (event.type === 'done') {
        terminal = event.message;
        continue;
      }
      if (event.type === 'error') {
        terminal = event.error;
        continue;
      }
    }
  } finally {
    // Every finished attempt records its usage, stop reason and duration to
    // Observability; retried attempts are never dropped.
    if (terminal) {
      recordObservedLog(dependencies, runtime, {
        level: 'info',
        event: 'model.call.attempt.finished',
        attributes: {
          modelCallId,
          attemptNumber,
          stopReason: terminal.stopReason,
          inputTokens: terminal.usage.input,
          outputTokens: terminal.usage.output,
          durationMs: Date.parse(dependencies.clock.now()) - Date.parse(startedAt),
        },
      });
    }
  }

  if (!terminal) {
    return {
      status: 'failed',
      failure: modelCallFailure({
        code: 'invalid_response',
        message: 'Model stream ended without a terminal event.',
        retryable: false,
      }),
      retryable: false,
    };
  }

  if (terminal.stopReason === 'aborted' || input.signal.aborted) {
    return {
      status: 'aborted',
      partial: { text: runtime.activeAssistantText, thinking: runtime.activeThinking },
    };
  }
  if (terminal.stopReason === 'error') {
    if (isContextOverflow(terminal, input.run.model.contextWindow)) {
      return { status: 'overflow', message: terminal };
    }
    const retryable = isRetryableAssistantError(terminal);
    return {
      status: 'failed',
      failure: {
        code: 'model_call_failed',
        message: terminal.errorMessage ?? 'Model call failed.',
        retryable,
        cause: { owner: 'ai', code: 'provider_error' },
      },
      retryable,
    };
  }
  return { status: 'completed', message: terminal };
}

interface ValidatedResponse {
  readonly status: 'valid';
  readonly toolCalls: readonly CompletedToolCall[];
}

type ValidationFailure = {
  readonly code: 'empty_response' | 'output_truncated' | 'invalid_response';
  readonly message: string;
  readonly retryable: boolean;
};

function validateCompletedResponse(
  modelCallId: string,
  message: AssistantMessage,
): { readonly status: 'valid'; readonly toolCalls: readonly CompletedToolCall[] } | { readonly status: 'invalid'; readonly failure: ValidationFailure } {
  if (message.stopReason === 'length') {
    return {
      status: 'invalid',
      failure: { code: 'output_truncated', message: 'Model output was truncated before completion.', retryable: false },
    };
  }
  if (message.stopReason === 'deferred') {
    return {
      status: 'invalid',
      failure: { code: 'invalid_response', message: 'Deferred responses are not supported.', retryable: false },
    };
  }

  const calls = message.content.filter((block): block is Extract<AssistantMessage['content'][number], { type: 'toolCall' }> => (
    block.type === 'toolCall'
  ));
  if (message.stopReason === 'stop') {
    if (calls.length > 0) {
      return {
        status: 'invalid',
        failure: { code: 'invalid_response', message: 'Model stopped normally but included a ToolCall.', retryable: false },
      };
    }
    if (!hasVisibleAssistantText(message)) {
      return {
        status: 'invalid',
        failure: { code: 'empty_response', message: 'Model returned no visible response.', retryable: true },
      };
    }
    return { status: 'valid', toolCalls: [] };
  }

  if (calls.length === 0) {
    return {
      status: 'invalid',
      failure: { code: 'invalid_response', message: 'Model reported Tool use without a ToolCall.', retryable: false },
    };
  }

  const seenIds = new Set<string>();
  const toolCalls: CompletedToolCall[] = [];
  for (const [callOrder, call] of calls.entries()) {
    if (
      !call.id
      || !call.name
      || seenIds.has(call.id)
      || !call.arguments
      || typeof call.arguments !== 'object'
      || Array.isArray(call.arguments)
    ) {
      return {
        status: 'invalid',
        failure: { code: 'invalid_response', message: 'Model response contained an invalid ToolCall identity.', retryable: false },
      };
    }
    seenIds.add(call.id);
    toolCalls.push({
      toolCallId: call.id,
      sourceModelCallId: modelCallId,
      callOrder,
      toolName: call.name,
      input: call.arguments,
    });
  }
  return { status: 'valid', toolCalls };
}

function hasVisibleAssistantText(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === 'text' && block.text.trim().length > 0);
}

async function executeToolCallBatch(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  modelCallId: string,
  calls: readonly CompletedToolCall[],
): Promise<'completed' | 'cancelled' | { readonly status: 'failed'; readonly failure: RunFailure }> {
  const results: ToolResult[] = [];
  const recordResult = (result: ToolResult) => {
    results.push(result);
  };
  // Parallel-mode calls accumulate into a window executed concurrently under
  // the confirmed concurrency limit; results commit in model call order.
  let parallelWindow: Array<{ call: CompletedToolCall; invocation: ToolInvocation }> = [];

  const closeWith = (result: (call: CompletedToolCall) => ToolResult, fromIndex: number) => {
    for (const remaining of calls.slice(fromIndex)) {
      recordResult(result(remaining));
    }
  };

  const flushParallelWindow = async (): Promise<'completed' | 'cancelled'> => {
    if (parallelWindow.length === 0) return 'completed';
    const window = [...parallelWindow];
    parallelWindow = [];
    if (input.signal.aborted) {
      for (const { call } of window) recordResult(cancelledToolResult(call, dependencies.clock.now()));
      return 'cancelled';
    }
    const concurrency = Math.max(1, dependencies.policy.maxConcurrentToolExecutions);
    const outcomes: Array<{ call: CompletedToolCall; outcome: ToolCallOutcome }> = [];
    for (let index = 0; index < window.length; index += concurrency) {
      const batch = window.slice(index, index + concurrency);
      outcomes.push(...await Promise.all(batch.map(async (entry) => ({
        call: entry.call,
        outcome: await executeToolCallWithPermissions(
          input, dependencies, runtime, modelCallId, entry.call, entry.invocation, [], undefined,
        ),
      }))));
    }
    for (const { call, outcome } of outcomes) {
      if (outcome.kind === 'cancelled') {
        recordResult(cancelledToolResult(call, dependencies.clock.now()));
        continue;
      }
      if (outcome.kind === 'failed') {
        recordResult(closedToolResult(call, dependencies.clock.now()));
        continue;
      }
      recordResult(outcome.result);
    }
    if (input.signal.aborted) return 'cancelled';
    return 'completed';
  };

  for (const [index, call] of calls.entries()) {
    if (input.signal.aborted) {
      const flushed = await flushParallelWindow();
      closeWith((remaining) => cancelledToolResult(remaining, dependencies.clock.now()), index);
      if (flushed === 'cancelled') {
        for (const pending of parallelWindow) {
          recordResult(cancelledToolResult(pending.call, dependencies.clock.now()));
        }
        parallelWindow = [];
      }
      await commitToolResults(input, dependencies, runtime, results);
      return 'cancelled';
    }

    const routed = dependencies.tools.routeToolCall({
      runId: input.run.runId,
      sessionId: input.run.sessionId,
      workspaceId: input.run.workspaceId,
      modelCallId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    });
    if (routed.status === 'failed') {
      await flushParallelWindow();
      recordResult({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        callOrder: call.callOrder,
        status: 'failure',
        error: { code: routed.error.code, message: routed.error.message },
        content: routed.error.message,
        completedAt: dependencies.clock.now(),
      });
      continue;
    }

    // Parallel execution mode runs the call in the shared window; anything
    // needing permission evaluation (or serial mode) flushes it first.
    if (routed.operations.length === 0 && routed.executionMode === 'parallel') {
      parallelWindow.push({ call, invocation: routed.invocation });
      continue;
    }

    const flushed = await flushParallelWindow();
    if (flushed === 'cancelled') {
      closeWith((remaining) => cancelledToolResult(remaining, dependencies.clock.now()), index);
      await commitToolResults(input, dependencies, runtime, results);
      return 'cancelled';
    }

    const executed = await executeToolCallWithPermissions(
      input,
      dependencies,
      runtime,
      modelCallId,
      call,
      routed.invocation,
      routed.operations,
      undefined,
    );
    if (executed.kind === 'cancelled') {
      recordResult(cancelledToolResult(call, dependencies.clock.now()));
      closeWith((remaining) => cancelledToolResult(remaining, dependencies.clock.now()), index + 1);
      await commitToolResults(input, dependencies, runtime, results);
      return 'cancelled';
    }
    if (executed.kind === 'failed') {
      // A Run failure closes every not-yet-settled ToolCall of this batch with
      // a model-visible failed ToolResult before the Run ends.
      recordResult(closedToolResult(call, dependencies.clock.now()));
      closeWith((remaining) => closedToolResult(remaining, dependencies.clock.now()), index + 1);
      await commitToolResults(input, dependencies, runtime, results);
      return { status: 'failed', failure: executed.failure };
    }
    recordResult(executed.result);
  }

  const flushed = await flushParallelWindow();
  await commitToolResults(input, dependencies, runtime, results);
  // Cancellation may win after the last call of the batch settled.
  if (flushed === 'cancelled' || input.signal.aborted) return 'cancelled';
  return 'completed';
}

type ToolCallOutcome =
  | { readonly kind: 'result'; readonly result: ToolResult }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly failure: RunFailure };

async function executeToolCallWithPermissions(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  modelCallId: string,
  call: CompletedToolCall,
  invocation: ToolInvocation,
  operations: readonly PermissionOperation[],
  executionAccess: ToolExecutionAccess | undefined,
): Promise<ToolCallOutcome> {
  if (operations.length === 0) {
    return {
      kind: 'result',
      result: await executeToolInvocation(input, dependencies, runtime, call, invocation, executionAccess),
    };
  }

  let permission;
  try {
    permission = await dependencies.permissions.evaluateToolCall({
      runId: input.run.runId,
      sessionId: input.run.sessionId,
      workspaceId: input.run.workspaceId,
      toolCallId: call.toolCallId,
      toolInput: snapshotValue(call.input) as import('@megumi/ai').JsonValue,
      operations,
      permissionMode: input.run.permissionMode,
      evaluatedAt: dependencies.clock.now(),
    });
  } catch {
    return { kind: 'failed', failure: permissionFailure('Permission evaluation failed.') };
  }
  if (permission.status === 'failed') {
    return { kind: 'failed', failure: permissionFailure(permission.failure.message) };
  }
  if (permission.decision.type === 'deny') {
    return {
      kind: 'result',
      result: {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        callOrder: call.callOrder,
        status: 'permission_denied',
        error: { code: permission.decision.denialCode, message: permission.decision.reason },
        content: permission.decision.reason,
        completedAt: dependencies.clock.now(),
      },
    };
  }

  if (permission.decision.type === 'requires_approval') {
    if (input.signal.aborted) return { kind: 'cancelled' };
    const approval = createRunApproval(dependencies, input.run, call, invocation, permission.decision);
    input.transitionRunStatus('waiting');
    // Register the wait before announcing it so an immediate resolveApproval
    // always finds the pending approval.
    const approvalWait = input.awaitApproval({ approval });
    emitApprovalRequested(dependencies, runtime, approval);
    const approvalSpan = startObservedSpan(dependencies, runtime, 'approval.wait');
    runtime.approvalSpan = approvalSpan;
    let resolution: ApprovalResolution;
    try {
      resolution = await approvalWait;
    } finally {
      endObservedSpan(dependencies, approvalSpan, 'ok');
      runtime.approvalSpan = undefined;
    }
    if (resolution.status === 'cancelled') {
      emitApprovalResolved(dependencies, runtime, approval, 'cancelled');
      return { kind: 'cancelled' };
    }

    const applied = await applyApprovalDecision(
      dependencies,
      runtime,
      call,
      operations,
      { decision: permission.decision, approvalSubject: permission.approvalSubject },
      resolution.decision,
    );
    if (applied.status === 'failed') {
      return { kind: 'failed', failure: permissionFailure('Approval decision could not be applied.') };
    }
    input.transitionRunStatus('running');
    emitApprovalResolved(
      dependencies,
      runtime,
      approval,
      resolution.status,
      resolution.status === 'approved' && resolution.decision.decision === 'approved'
        ? resolution.decision.optionId
        : undefined,
    );
    if (resolution.status === 'denied') {
      return {
        kind: 'result',
        result: {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          callOrder: call.callOrder,
          status: 'user_rejected',
          error: { code: 'user_rejected', message: 'Tool call was rejected by the user.' },
          content: 'Tool call was rejected by the user.',
          completedAt: dependencies.clock.now(),
        },
      };
    }
    return {
      kind: 'result',
      result: await executeToolInvocation(input, dependencies, runtime, call, invocation, applied.executionAccess),
    };
  }

  if (!permission.executionAccess) {
    return { kind: 'failed', failure: permissionFailure('Permission allow decision did not provide Tool execution access.') };
  }
  return {
    kind: 'result',
    result: await executeToolInvocation(input, dependencies, runtime, call, invocation, permission.executionAccess),
  };
}

async function applyApprovalDecision(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  call: CompletedToolCall,
  operations: readonly PermissionOperation[],
  original: {
    readonly decision: Extract<PermissionDecision, { type: 'requires_approval' }>;
    readonly approvalSubject: ApprovalSubject;
  },
  decision: ApprovalDecision,
): Promise<{ readonly status: 'applied'; readonly executionAccess?: ToolExecutionAccess } | { readonly status: 'failed' }> {
  try {
    const current = await dependencies.permissions.evaluateToolCall({
      runId: runtime.run.runId,
      sessionId: runtime.run.sessionId,
      workspaceId: runtime.run.workspaceId,
      toolCallId: call.toolCallId,
      toolInput: snapshotValue(call.input) as import('@megumi/ai').JsonValue,
      operations,
      permissionMode: runtime.run.permissionMode,
      evaluatedAt: dependencies.clock.now(),
    });
    if (current.status === 'failed') throw new Error(current.failure.message);
    const applied = await dependencies.permissions.applyApprovalDecision({
      originalPermissionDecision: original.decision,
      originalSubject: original.approvalSubject,
      currentSubject: current.approvalSubject,
      decision,
      sessionId: runtime.run.sessionId,
      appliedAt: dependencies.clock.now(),
      permissionMode: runtime.run.permissionMode,
    });
    if (applied.status !== 'applied') return { status: 'failed' };
    return { status: 'applied', ...(applied.executionAccess ? { executionAccess: applied.executionAccess } : {}) };
  } catch {
    return { status: 'failed' };
  }
}

async function executeToolInvocation(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  call: CompletedToolCall,
  invocation: ToolInvocation,
  executionAccess: ToolExecutionAccess | undefined,
): Promise<ToolResult> {
  const toolExecutionId = dependencies.ids.createToolExecutionId();
  const startedAt = dependencies.clock.now();
  const span = startObservedSpan(dependencies, runtime, 'tool.call');
  if (span) runtime.toolSpans.set(toolExecutionId, span);

  emitEvent(dependencies, runtime, 'tool_execution.started', {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    args: toJsonValue(call.input) as Record<string, unknown>,
    toolExecutionId,
  });

  let accumulatedOutput = '';
  let planNotification: import('@megumi/tools').ToolExecutionNotification | undefined;
  let result;
  try {
    const timeoutController = new AbortController();
    const executionSignal = AbortSignal.any([input.signal, timeoutController.signal]);
    const timeout = setTimeout(() => timeoutController.abort(), dependencies.policy.toolExecutionTimeoutMs);
    const cancelTimer = () => clearTimeout(timeout);
    try {
      result = await Promise.resolve(dependencies.tools.executeToolInvocation({
        invocation,
        toolExecutionId,
      }, {
        signal: executionSignal,
        onOutput: (output) => {
          accumulatedOutput += output.chunk;
          emitEvent(dependencies, runtime, 'tool_execution.update', {
            toolCallId: call.toolCallId,
            output: accumulatedOutput,
          });
        },
        onNotification: (notification) => {
          planNotification = notification;
          emitEvent(dependencies, runtime, 'tool_execution.plan_updated', {
            toolCallId: call.toolCallId,
            ...(notification.explanation ? { explanation: notification.explanation } : {}),
            plan: notification.plan.map((step) => ({ step: step.step, status: step.status })),
          });
        },
        ...(executionAccess ? { executionAccess } : {}),
      })).catch((error: unknown) => ({ type: 'thrown' as const, error }));
    } finally {
      cancelTimer();
    }
  } catch {
    result = { type: 'thrown', error: new Error('Tool execution failed to start.') };
  }

  const completedAt = dependencies.clock.now();
  if (span) {
    endObservedSpan(dependencies, span, input.signal.aborted ? 'cancelled' : 'ok');
    runtime.toolSpans.delete(toolExecutionId);
  }

  if (result && 'type' in result && result.type === 'thrown') {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      callOrder: call.callOrder,
      status: 'failure',
      error: { code: 'tool_execution_failed', message: 'Tool execution failed.' },
      content: 'Tool execution failed.',
      completedAt,
    };
  }

  const executionResult = result as import('@megumi/tools').ToolExecutionResult;
  if (input.signal.aborted && !executionResult) {
    return cancelledToolResult(call, completedAt);
  }

  if (executionResult.type === 'succeeded') {
    const toolResult: ToolResult = {
      toolCallId: call.toolCallId,
      toolName: executionResult.toolName,
      callOrder: call.callOrder,
      status: 'success',
      content: executionResult.normalizedResult.content,
      ...(executionResult.observation?.summary ? { summary: executionResult.observation.summary } : {}),
      completedAt,
    };
    emitToolExecutionEnded(dependencies, runtime, toolResult, toolExecutionId, 'completed');
    return toolResult;
  }

  if (executionResult.error.code === 'tool_cancelled') {
    emitToolExecutionEnded(dependencies, runtime, {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      callOrder: call.callOrder,
      status: 'cancelled',
      content: executionResult.normalizedResult.content,
      completedAt,
    }, toolExecutionId, 'cancelled');
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      callOrder: call.callOrder,
      status: 'cancelled',
      error: { code: 'tool_cancelled', message: 'Tool call was cancelled.' },
      content: executionResult.normalizedResult.content,
      completedAt,
    };
  }

  emitToolExecutionEnded(dependencies, runtime, {
    toolCallId: call.toolCallId,
    toolName: executionResult.toolName ?? call.toolName,
    callOrder: call.callOrder,
    status: 'failure',
    error: executionResult.error,
    content: executionResult.normalizedResult.content,
    completedAt,
  }, toolExecutionId, 'failed');
  return {
    toolCallId: call.toolCallId,
    toolName: executionResult.toolName ?? call.toolName,
    callOrder: call.callOrder,
    status: 'failure',
    error: executionResult.error,
    content: executionResult.normalizedResult.content,
    completedAt,
  };
}

function emitToolExecutionEnded(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  result: ToolResult,
  toolExecutionId: string,
  status: 'completed' | 'failed' | 'cancelled',
): void {
  if (status === 'completed') {
    emitEvent(dependencies, runtime, 'tool_execution.ended', {
      toolCallId: result.toolCallId,
      toolExecutionId,
      status: 'completed',
      result: result.content,
      ...(result.summary ? { summary: result.summary } : {}),
    });
    return;
  }
  if (status === 'cancelled') {
    emitEvent(dependencies, runtime, 'tool_execution.ended', {
      toolCallId: result.toolCallId,
      toolExecutionId,
      status: 'cancelled',
    });
    return;
  }
  const error = result.error ?? { code: 'tool_execution_failed', message: 'Tool execution failed.' };
  emitEvent(dependencies, runtime, 'tool_execution.ended', {
    toolCallId: result.toolCallId,
    toolExecutionId,
    status: 'failed',
    error: { message: error.message, code: error.code },
  });
}

async function commitToolResults(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  results: readonly ToolResult[],
): Promise<boolean> {
  for (const result of [...results].sort((left, right) => left.callOrder - right.callOrder)) {
    const saved = dependencies.session.saveToolResultMessage({
      message_id: dependencies.ids.createSessionMessageId(),
      session_id: input.run.sessionId,
      run_id: input.run.runId,
      parent_entry_id: runtime.lastCommittedEntryId,
      tool_call_id: result.toolCallId,
      tool_name: result.toolName,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
      content: [{ type: 'text', text: result.content }],
      completed_at: result.completedAt,
    });
    if (saved.status === 'failed') {
      throw new SessionCommitFailure(saved.failure.message);
    }
    runtime.lastCommittedEntryId = saved.entry.entry_id;
    emitEvent(dependencies, runtime, 'message.started', {
      role: 'tool_result',
      messageId: saved.message.message_id,
    });
    emitEvent(dependencies, runtime, 'message.ended', {
      role: 'tool_result',
      messageId: saved.message.message_id,
      content: result.content,
    });
    if (result.status === 'permission_denied' || result.status === 'user_rejected') {
      emitEvent(dependencies, runtime, 'tool_execution.ended', {
        toolCallId: result.toolCallId,
        status: 'denied',
      });
    }
  }
  return true;
}

async function commitCancelledReply(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  partial: { readonly text: string; readonly thinking: string },
): Promise<void> {
  const content: SessionAssistantContent[] = [];
  if (partial.thinking) content.push({ type: 'thinking', thinking: partial.thinking });
  if (partial.text) content.push({ type: 'text', text: partial.text });
  const reply = dependencies.session.saveAssistantReply({
    // Reuse the streaming identity when a message lifecycle was started;
    // otherwise settle a fresh cancelled reply for the Run.
    message_id: runtime.activeModelMessageId ?? dependencies.ids.createSessionMessageId(),
    session_id: input.run.sessionId,
    run_id: input.run.runId,
    parent_entry_id: runtime.lastCommittedEntryId,
    status: 'cancelled',
    content,
    reason_code: 'user_cancelled',
    completed_at: dependencies.clock.now(),
  });
  if (reply.status === 'saved') {
    runtime.lastCommittedEntryId = reply.entry.entry_id;
    emitEvent(dependencies, runtime, 'message.ended', {
      role: 'assistant',
      messageId: reply.message.message_id,
      content: partial.text,
    });
  }
}

function createRunApproval(
  dependencies: AgentLoopDependencies,
  run: Run,
  call: CompletedToolCall,
  invocation: ToolInvocation,
  decision: Extract<PermissionDecision, { type: 'requires_approval' }>,
): RunApproval {
  return {
    runApprovalId: dependencies.ids.createRunApprovalId(),
    runId: run.runId,
    toolCallId: call.toolCallId,
    toolName: invocation.toolName,
    toolIdentity: snapshotToolIdentity(invocation.toolIdentity),
    input: snapshotValue(call.input),
    operations: decision.operations.map((operation) => snapshotValue(operation) as PermissionOperation),
    options: decision.options,
    defaultOptionId: decision.defaultOptionId,
    summary: `${invocation.toolName} requires approval.`,
    createdAt: dependencies.clock.now(),
    status: 'pending',
  };
}

function emitApprovalRequested(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  approval: RunApproval,
): void {
  emitEvent(dependencies, runtime, 'approval.requested', {
    toolCallId: approval.toolCallId,
    toolName: approval.toolName,
    toolIdentity: {
      sourceId: approval.toolIdentity.sourceId,
      namespace: approval.toolIdentity.namespace,
      sourceToolName: approval.toolIdentity.sourceToolName,
    },
    reason: approval.summary ?? `Approve ${approval.toolName}`,
    args: toJsonValue(approval.input) as Record<string, unknown>,
    operations: approval.operations.map((operation) => toJsonValue(operation) as Record<string, unknown>),
    approvalRequestId: approval.runApprovalId,
    options: approval.options.map((option) => ({
      optionId: option.optionId,
      scope: option.scope,
      label: option.display.label,
      description: option.display.description,
    })),
    defaultOptionId: approval.defaultOptionId,
    ...(approval.preview
      ? {
          preview: {
            action: approval.preview.action,
            targets: approval.preview.targets.map((target) => ({ ...target })),
          },
        }
      : {}),
  });
}

function emitApprovalResolved(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  approval: RunApproval,
  decision: 'approved' | 'denied' | 'cancelled',
  optionId?: string,
): void {
  emitEvent(dependencies, runtime, 'approval.resolved', {
    approvalRequestId: approval.runApprovalId,
    toolCallId: approval.toolCallId,
    decision,
    ...(decision === 'approved' && optionId ? { optionId } : {}),
    decidedAt: dependencies.clock.now(),
  });
}

function publishRetryStarted(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  nextAttemptNumber: number,
  maxAttempts: number,
): void {
  recordObservedLog(dependencies, runtime, {
    level: 'info',
    event: 'model.call.retry.scheduled',
    attributes: { nextAttemptNumber, maxAttempts },
  });
  emitEvent(dependencies, runtime, 'turn.retry.started', {
    attemptNumber: nextAttemptNumber,
    retryKind: 'model_call',
  });
}

function publishRetryCompleted(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  retriedAttempts: readonly number[],
): void {
  for (const attemptNumber of retriedAttempts) {
    recordObservedLog(dependencies, runtime, {
      level: 'info',
      event: 'model.call.retry.completed',
      attributes: { retryAttemptNumber: attemptNumber },
    });
    emitEvent(dependencies, runtime, 'turn.retry.completed', { attemptNumber });
  }
}

function publishRetryFailed(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  retriedAttempts: readonly number[],
  failure: { readonly code?: string; readonly message: string },
): void {
  for (const attemptNumber of retriedAttempts) {
    recordObservedLog(dependencies, runtime, {
      level: 'warn',
      event: 'model.call.retry.failed',
      attributes: { retryAttemptNumber: attemptNumber },
    });
    emitEvent(dependencies, runtime, 'turn.retry.failed', {
      attemptNumber,
      error: { message: failure.message, ...(failure.code ? { code: failure.code } : {}) },
    });
  }
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

function startLoopObservability(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
): void {
  if (!dependencies.observability) return;
  try {
    const trace = dependencies.observability.startTrace({
      traceId: runtime.run.runId,
      name: 'agent_run',
      runId: runtime.run.runId,
      sessionId: runtime.run.sessionId,
      workspaceId: runtime.run.workspaceId,
      requestId: runtime.run.requestId,
      attributes: {
        providerId: String(runtime.run.model.provider),
        modelId: runtime.run.model.id,
      },
    });
    const rootSpan = dependencies.observability.runInTraceContext(trace, () => (
      dependencies.observability!.startSpan({ name: 'agent_run' })
    ));
    runtime.trace = trace;
    runtime.rootSpan = rootSpan;
  } catch {
    // Diagnostics never own Run outcome.
  }
}

function endLoopObservability(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  status: 'ok' | 'error' | 'cancelled',
): void {
  if (!dependencies.observability || runtime.observabilityEnded) return;
  runtime.observabilityEnded = true;
  endObservedSpan(dependencies, runtime.modelSpan, status);
  runtime.modelSpan = undefined;
  endObservedSpan(dependencies, runtime.approvalSpan, status);
  runtime.approvalSpan = undefined;
  for (const span of runtime.toolSpans.values()) {
    endObservedSpan(dependencies, span, status);
  }
  runtime.toolSpans.clear();
  try {
    endObservedSpan(dependencies, runtime.rootSpan, status);
    if (runtime.trace) {
      dependencies.observability.endTrace({ trace: runtime.trace, status });
    }
  } catch {
    // Diagnostics never own Run outcome.
  }
}

function startObservedSpan(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  name: ObservabilitySpanName,
): SpanHandle | undefined {
  if (!dependencies.observability) return undefined;
  try {
    return dependencies.observability.startSpan({
      name,
      correlation: observedCorrelation(runtime),
    });
  } catch {
    return undefined;
  }
}

function endObservedSpan(
  dependencies: AgentLoopDependencies,
  span: SpanHandle | undefined,
  status: 'ok' | 'error' | 'cancelled',
): void {
  if (!dependencies.observability || !span) return;
  try {
    dependencies.observability.endSpan({ span, status });
  } catch {
    // Diagnostics never own Run outcome.
  }
}

function recordObservedLog(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  input: {
    readonly level: 'info' | 'warn' | 'error';
    readonly event: string;
    readonly attributes?: Record<string, unknown>;
  },
): void {
  if (!dependencies.observability) return;
  try {
    dependencies.observability.recordLog({
      ...input,
      correlation: observedCorrelation(runtime),
    });
  } catch {
    // Diagnostics never own Run outcome.
  }
}

function recordObservedMeasurement(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  input: {
    readonly name: string;
    readonly value: number;
    readonly unit: 'count';
    readonly attributes?: Record<string, unknown>;
  },
): void {
  if (!dependencies.observability) return;
  try {
    dependencies.observability.recordMeasurement({
      ...input,
      correlation: observedCorrelation(runtime),
    });
  } catch {
    // Diagnostics never own Run outcome.
  }
}

function observedCorrelation(runtime: LoopRuntime) {
  return {
    ...(runtime.trace ? { traceId: runtime.trace.traceId } : {}),
    ...(runtime.rootSpan ? { spanId: runtime.rootSpan.spanId } : {}),
    runId: runtime.run.runId,
    sessionId: runtime.run.sessionId,
    workspaceId: runtime.run.workspaceId,
    requestId: runtime.run.requestId,
  };
}

// ---------------------------------------------------------------------------
// Events, failures and helpers
// ---------------------------------------------------------------------------

function emitEvent<TType extends EventType>(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  type: TType,
  payload: EventPayloadByType[TType],
): void {
  dependencies.events.publish({
    type,
    payload,
    sessionId: runtime.run.sessionId,
    runId: runtime.run.runId,
  });
}

function cancelledResult(): AgentLoopResult {
  return { status: 'cancelled' };
}

function failedResult(failure: RunFailure): AgentLoopResult {
  return { status: 'failed', failure };
}

function sessionFailure(message: string): RunFailure {
  return {
    code: 'session_failed',
    message,
    retryable: false,
    cause: { owner: 'session', code: 'session_failed' },
  };
}

function loopLimitFailure(message: string): RunFailure {
  return {
    code: 'loop_limit_exceeded',
    message,
    retryable: false,
    cause: { owner: 'engine', code: 'loop_limit_exceeded' },
  };
}

function permissionFailure(message: string): RunFailure {
  return {
    code: 'permission_failed',
    message,
    retryable: false,
    cause: { owner: 'permissions', code: 'permission_evaluation_failed' },
  };
}

function modelCallFailure(failure: { readonly code: string; readonly message: string; readonly retryable: boolean }): RunFailure {
  return {
    code: 'model_call_failed',
    message: failure.message,
    retryable: failure.retryable,
    cause: { owner: 'ai', code: failure.code },
  };
}

function toAssistantContent(message: AssistantMessage): SessionAssistantContent[] {
  return message.content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'thinking') {
      return { type: 'thinking', thinking: block.thinking };
    }
    return {
      type: 'toolCall',
      id: block.id,
      name: block.name,
      arguments: block.arguments as Record<string, unknown>,
    };
  });
}

function assistantMetadata(message: AssistantMessage): {
  api?: string;
  provider?: string;
  model?: string;
  response_model?: string;
  response_id?: string;
  usage?: import('@megumi/ai').Usage;
  error_message?: string;
} {
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

function contentText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function thinkingText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('');
}

function cancelledToolResult(call: CompletedToolCall, completedAt: string): ToolResult {
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    callOrder: call.callOrder,
    status: 'cancelled',
    error: { code: 'tool_cancelled', message: 'Tool call was cancelled.' },
    content: 'Tool call was cancelled.',
    completedAt,
  };
}

function closedToolResult(call: CompletedToolCall, completedAt: string): ToolResult {
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    callOrder: call.callOrder,
    status: 'failure',
    error: { code: 'run_failed_before_tool_result', message: 'Run failed before ToolCall produced a result.' },
    content: 'Run failed before ToolCall produced a result.',
    completedAt,
  };
}

function failureReason(
  failure: RunFailure,
):
  | 'session_failed'
  | 'context_failed'
  | 'model_call_failed'
  | 'approval_failed'
  | 'tool_call_failed'
  | 'loop_limit_exceeded'
  | 'runtime_protocol_violation'
  | 'internal_error' {
  if (
    failure.code === 'session_failed'
    || failure.code === 'context_failed'
    || failure.code === 'model_call_failed'
    || failure.code === 'loop_limit_exceeded'
    || failure.code === 'runtime_protocol_violation'
  ) {
    return failure.code;
  }
  if (failure.code === 'permission_failed') return 'approval_failed';
  if (failure.code === 'tool_system_failed') return 'tool_call_failed';
  return 'internal_error';
}

function snapshotToolIdentity(identity: ToolIdentity): ToolIdentity {
  return { ...identity };
}

function snapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, snapshotValue(item)]),
    );
  }
  return value;
}

function toJsonValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

class ContextBuildFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ContextBuildFailure';
  }
}

class SessionCommitFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionCommitFailure';
  }
}
