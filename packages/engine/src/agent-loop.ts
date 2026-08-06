/*
 * The single Agent execution loop: one runAgentLoop() call drives Context
 * builds, AI model streams, Tool Call batches, approval waits, Session
 * commits and the final Run outcome for one Run. The loop keeps no state
 * across calls: all tool batches, attempts, stream snapshots and observation
 * handles are local to this function invocation.
 */
import type { AssistantMessage, Models } from '@megumi/ai';
import type { EventBus, EventPayloadByType, EventType } from '@megumi/events';
import type { UserInput } from '@megumi/input';
import type { ObservabilityService } from '@megumi/observability';
import type {
  PermissionDecision,
  PermissionOperation,
  Permissions,
} from '@megumi/permissions';
import type { SessionAssistantContent, SessionEntry } from '@megumi/session';
import type { ToolIdentity, ToolInvocation, Tools } from '@megumi/tools';
import type { ContextCapabilities, Prompt, RunContext } from '@megumi/context';
import type { RunApproval, RunClock, Run, RunFailure } from './run';
import type { RunPolicy } from './run-policy';
import type { ApprovalResolution } from './run-registry';
import {
  runModelCall,
  type CompletedToolCall,
  type ModelCallFailure,
  type ModelCallOutcome,
  type ModelCallProjection,
  type RebuildPromptResult,
} from './model-call-runner';
import {
  createSessionMessageCommitter,
  type AssistantReplyMetadata,
  type SessionMessageCommitter,
} from './session-message-committer';
import {
  runToolCallBatch,
  type ToolCallFailure,
  type ToolResult,
} from './tool-call-runner';
import { createLoopObserver, type LoopObserver } from './loop-observer';

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
  /** The single Session Entry chain owner; the loop only decides commit timing. */
  readonly committer: SessionMessageCommitter;
  modelCallCount: number;
  toolRoundCount: number;
  toolCallCount: number;
  activeModelMessageId?: string;
  /** The current ModelCall's streamed projection; the ModelCall Runner owns its updates. */
  projection: ModelCallProjection;
  /** The run-scoped Observability resource handle. */
  readonly observer: LoopObserver;
  /** A started assistant Message lifecycle that still needs its one ended event. */
  messageLifecycleOpen: boolean;
  /** A started Turn lifecycle that still needs its one ended event. */
  turnLifecycleOpen: boolean;
}

export async function runAgentLoop(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
): Promise<AgentLoopResult> {
  const runtime: LoopRuntime = {
    run: input.run,
    userInput: input.userInput,
    committer: createSessionMessageCommitter({
      userEntry: input.userEntry,
      session: dependencies.session,
      ids: dependencies.ids,
    }),
    modelCallCount: 0,
    toolRoundCount: 0,
    toolCallCount: 0,
    projection: { text: '', thinking: '' },
    observer: createLoopObserver({
      run: input.run,
      observability: dependencies.observability,
    }),
    messageLifecycleOpen: false,
    turnLifecycleOpen: false,
  };
  runtime.observer.start();
  // A Run failure settles one terminal Assistant Reply with the failure reason
  // (session failures commit nothing; the Session owns the error already).
  const failRun = async (failure: RunFailure): Promise<AgentLoopResult> => {
    if (input.signal.aborted) return cancelledResult();
    if (failure.code !== 'session_failed') {
      const reply = await runtime.committer.commitAssistantReply({
        sessionId: input.run.sessionId,
        runId: input.run.runId,
        status: 'failed',
        content: [],
        reasonCode: failureReason(failure),
        completedAt: dependencies.clock.now(),
      });
      if (reply.status === 'failed') return failedResult(sessionFailure(reply.failure.message));
      // The failed Reply is a new real Session Message: it gets the complete
      // lifecycle pair matching that fact.
      emitEvent(dependencies, runtime, 'message.started', {
        role: 'assistant',
        messageId: reply.messageId,
      });
      emitEvent(dependencies, runtime, 'message.ended', {
        role: 'assistant',
        messageId: reply.messageId,
        content: '',
      });
    }
    return failedResult(failure);
  };
  let finalResult: AgentLoopResult | undefined;
  try {
    if (input.signal.aborted) {
      finalResult = cancelledResult();
    } else {
      for (;;) {
        if (input.signal.aborted) {
          finalResult = cancelledResult();
          break;
        }
        if (runtime.modelCallCount >= dependencies.policy.maxModelCallsPerRun) {
          finalResult = await failRun(loopLimitFailure('ModelCall limit reached.'));
          break;
        }
        const outcome = await runTurn(input, dependencies, runtime, failRun);
        if (outcome === 'next') continue;
        finalResult = outcome;
        break;
      }
    }
  } catch (error) {
    if (input.signal.aborted) {
      closeMessageLifecycle(dependencies, runtime, runtime.activeModelMessageId ?? '', runtime.projection.text);
      closeTurnLifecycle(dependencies, runtime, 'cancelled', runtime.activeModelMessageId ?? '', []);
      finalResult = cancelledResult();
    } else {
      closeMessageLifecycle(dependencies, runtime, runtime.activeModelMessageId ?? '', runtime.projection.text);
      closeTurnLifecycle(dependencies, runtime, 'error', runtime.activeModelMessageId ?? '', []);
      finalResult = await failRun({
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Engine failed unexpectedly.',
        retryable: false,
        cause: { owner: 'engine', code: 'unexpected_exception' },
      });
    }
  } finally {
    // The Run Observer ends with the real AgentLoopResult, never a constant.
    runtime.observer.end(
      finalResult?.status === 'completed' ? 'ok'
        : finalResult?.status === 'failed' ? 'error'
        : 'cancelled',
    );
  }
  return finalResult!;
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
    // The first Prompt build and every Overflow rebuild share the same
    // Context failure contract: original code, message and retryable facts.
    const buildPrompt = async (): Promise<RebuildPromptResult> => {
      const built = await dependencies.context.build({
        modelCallContext: { modelCallId, run: runContext, tools: toolResolution.definitions },
        signal: input.signal,
      });
      if (built.status === 'failed') {
        return {
          status: 'failed',
          failure: {
            code: built.failure.code,
            message: built.failure.message,
            retryable: built.failure.retryable,
          },
        };
      }
      return { status: 'ready', prompt: built.prompt };
    };
    let prompt: Prompt;
    const firstBuild = await buildPrompt();
    if (firstBuild.status === 'failed') {
      if (input.signal.aborted) {
        await commitCancelledReply(input, dependencies, runtime, { text: '', thinking: '' });
        return cancelledResult();
      }
      return await failRun({
        code: 'context_failed',
        message: firstBuild.failure.message,
        retryable: firstBuild.failure.retryable,
        cause: { owner: 'context', code: firstBuild.failure.code },
      });
    }
    prompt = firstBuild.prompt;

    // Cancellation may win during the build: converge without starting a Turn
    // or a ModelCall, but still settle the cancelled reply for the Run.
    if (input.signal.aborted) {
      await commitCancelledReply(input, dependencies, runtime, { text: '', thinking: '' });
      return cancelledResult();
    }

    // One message identity spans the whole streaming Turn and is reused when
    // the reply is stored.
    runtime.activeModelMessageId = dependencies.ids.createSessionMessageId();
    runtime.projection.text = '';
    runtime.projection.thinking = '';
    emitEvent(dependencies, runtime, 'turn.started', { messageId: runtime.activeModelMessageId });
    emitEvent(dependencies, runtime, 'message.started', {
      role: 'assistant',
      messageId: runtime.activeModelMessageId,
    });
    runtime.turnLifecycleOpen = true;
    runtime.messageLifecycleOpen = true;
    runtime.modelCallCount += 1;

    const modelSpan = runtime.observer.startSpan('model.call', { modelCallId });
    let modelOutcome: ModelCallOutcome | undefined;
    try {
      modelOutcome = await runModelCall({
        runId: input.run.runId,
        sessionId: input.run.sessionId,
        workspaceId: input.run.workspaceId,
        model: input.run.model,
        modelCallId,
        messageId: runtime.activeModelMessageId ?? '',
        prompt,
        buildPrompt,
        signal: input.signal,
        projection: runtime.projection,
        events: {
          publish: (type, payload) => emitEvent(dependencies, runtime, type, payload),
        },
        observation: {
          recordLog: (log) => runtime.observer.recordLog(log),
          recordMeasurement: (measurement) => runtime.observer.recordMeasurement(measurement),
        },
        models: dependencies.models,
        context: dependencies.context,
        policy: dependencies.policy,
        clock: dependencies.clock,
      });
    } finally {
      // The ModelCall span ends with the real ModelCall outcome.
      runtime.observer.endSpan(
        modelSpan,
        modelOutcome === undefined
          ? (input.signal.aborted ? 'cancelled' : 'error')
          : modelOutcome.status === 'completed' ? 'ok'
          : modelOutcome.status === 'failed' ? 'error'
          : 'cancelled',
      );
    }

    if (modelOutcome.status === 'cancelled') {
      await commitCancelledReply(input, dependencies, runtime, modelOutcome.partial);
      closeTurnLifecycle(dependencies, runtime, 'cancelled', runtime.activeModelMessageId ?? '', []);
      return cancelledResult();
    }
    if (modelOutcome.status === 'failed') {
      // A started message lifecycle always gets exactly one closing event.
      closeMessageLifecycle(dependencies, runtime, runtime.activeModelMessageId ?? '', runtime.projection.text);
      closeTurnLifecycle(dependencies, runtime, 'error', runtime.activeModelMessageId ?? '', []);
      return await failRun(modelCallRunFailure(modelOutcome.failure));
    }

    const assistantContent = toAssistantContent(modelOutcome.message);
    const assistantText = assistantContent
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const messageId = runtime.activeModelMessageId ?? dependencies.ids.createSessionMessageId();

    if (modelOutcome.toolCalls.length === 0) {
      const reply = await runtime.committer.commitAssistantReply({
        sessionId: input.run.sessionId,
        runId: input.run.runId,
        status: 'completed',
        content: assistantContent,
        reasonCode: 'normal_completion',
        messageId,
        metadata: assistantMetadata(modelOutcome.message),
        completedAt: dependencies.clock.now(),
      });
      if (reply.status === 'failed') {
        closeMessageLifecycle(dependencies, runtime, messageId, assistantText);
        closeTurnLifecycle(dependencies, runtime, 'error', messageId, []);
        return await failRun(sessionFailure(reply.failure.message));
      }
      closeMessageLifecycle(dependencies, runtime, reply.messageId, assistantText);
      closeTurnLifecycle(dependencies, runtime, 'completed', reply.messageId, []);
      return { status: 'completed', assistantMessageId: reply.messageId };
    }

    if (
      modelOutcome.toolCalls.length > dependencies.policy.maxToolCallsPerModelCall
      || runtime.toolCallCount + modelOutcome.toolCalls.length > dependencies.policy.maxToolCallsPerRun
    ) {
      closeMessageLifecycle(dependencies, runtime, messageId, assistantText);
      closeTurnLifecycle(dependencies, runtime, 'error', messageId, []);
      return await failRun(loopLimitFailure('ToolCall limit reached.'));
    }
    if (runtime.toolRoundCount >= dependencies.policy.maxToolRoundsPerRun) {
      closeMessageLifecycle(dependencies, runtime, messageId, assistantText);
      closeTurnLifecycle(dependencies, runtime, 'error', messageId, []);
      return await failRun(loopLimitFailure('Tool round limit reached.'));
    }

    const response = await runtime.committer.commitModelResponse({
      sessionId: input.run.sessionId,
      runId: input.run.runId,
      messageId,
      content: assistantContent,
      stopReason: modelOutcome.message.stopReason,
      metadata: assistantMetadata(modelOutcome.message),
      completedAt: dependencies.clock.now(),
    });
    if (response.status === 'failed') {
      closeMessageLifecycle(dependencies, runtime, messageId, assistantText);
      closeTurnLifecycle(dependencies, runtime, 'error', messageId, []);
      return await failRun(sessionFailure(response.failure.message));
    }
    closeMessageLifecycle(dependencies, runtime, response.messageId, assistantText);
    runtime.toolCallCount += modelOutcome.toolCalls.length;
    runtime.toolRoundCount += 1;

    const batch = await runToolCallBatch({
      runId: input.run.runId,
      sessionId: input.run.sessionId,
      workspaceId: input.run.workspaceId,
      permissionMode: input.run.permissionMode,
      modelCallId,
      calls: modelOutcome.toolCalls,
      signal: input.signal,
      tools: dependencies.tools,
      permissions: dependencies.permissions,
      policy: dependencies.policy,
      ids: dependencies.ids,
      clock: dependencies.clock,
      events: {
        publish: (type, payload) => emitEvent(dependencies, runtime, type, payload),
      },
      observation: {
        startSpan: (attributes) => runtime.observer.startSpan('tool.call', attributes),
        endSpan: (span, status) => runtime.observer.endSpan(span, status),
      },
      // The Agent Loop owns the whole approval lifecycle: it applies the
      // waiting/running transitions, publishes the lifecycle facts, and waits
      // on the Run's pending approval promise in place.
      requestApproval: async (approvalRequest) => {
        const approval = createRunApproval(
          dependencies,
          input.run,
          approvalRequest.call,
          approvalRequest.invocation,
          approvalRequest.decision,
        );
        input.transitionRunStatus('waiting');
        // Register the wait before announcing it so an immediate resolveApproval
        // always finds the pending approval.
        const approvalWait = input.awaitApproval({ approval });
        emitApprovalRequested(dependencies, runtime, approval);
        const approvalSpan = runtime.observer.startSpan('approval.wait', {
          approvalId: approval.runApprovalId,
          toolCallId: approval.toolCallId,
        });
        let resolution: ApprovalResolution | undefined;
        try {
          resolution = await approvalWait;
        } finally {
          // The Approval span ends with the real resolution; a cancelled wait
          // is recorded as cancelled, not ok.
          runtime.observer.endSpan(
            approvalSpan,
            resolution?.status === 'cancelled' ? 'cancelled' : 'ok',
          );
        }
        if (resolution.status === 'cancelled') {
          emitApprovalResolved(dependencies, runtime, approval, 'cancelled');
          return resolution;
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
        return resolution;
      },
    });
    const committed = await commitToolResults(input, dependencies, runtime, batch.results);
    if (committed !== 'committed') {
      // A Session commit failure stops the execution; cancellation wins when
      // the signal is aborted.
      if (input.signal.aborted) {
        await commitCancelledReply(input, dependencies, runtime, {
          text: runtime.projection.text,
          thinking: runtime.projection.thinking,
        });
        closeTurnLifecycle(
          dependencies, runtime, 'cancelled', messageId,
          modelOutcome.toolCalls.map((call) => call.toolCallId),
        );
        return cancelledResult();
      }
      closeTurnLifecycle(
        dependencies, runtime, 'error', messageId,
        modelOutcome.toolCalls.map((call) => call.toolCallId),
      );
      return await failRun(committed.failure);
    }
    if (batch.status === 'cancelled') {
      await commitCancelledReply(input, dependencies, runtime, {
        text: runtime.projection.text,
        thinking: runtime.projection.thinking,
      });
      closeTurnLifecycle(
        dependencies, runtime, 'cancelled', messageId,
        modelOutcome.toolCalls.map((call) => call.toolCallId),
      );
      return cancelledResult();
    }
    if (batch.status === 'failed') {
      closeTurnLifecycle(
        dependencies, runtime, 'error', messageId,
        modelOutcome.toolCalls.map((call) => call.toolCallId),
      );
      return await failRun(toolCallRunFailure(batch.failure));
    }
    closeTurnLifecycle(
      dependencies, runtime, 'tool_calls', messageId,
      modelOutcome.toolCalls.map((call) => call.toolCallId),
    );
    return 'next';
  } finally {
    // The ModelCall Tools route must always be released; a release failure is
    // only a diagnostic and never overrides the already determined business
    // result or saves a second terminal Reply.
    try {
      dependencies.tools.releaseModelCallTools({ modelCallId });
    } catch (error) {
      runtime.observer.recordLog({
        level: 'error',
        event: 'tool.router.release_failed',
        attributes: {
          modelCallId,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}


async function commitToolResults(
  input: AgentLoopInput,
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  results: readonly ToolResult[],
): Promise<'committed' | { readonly status: 'failed'; readonly failure: RunFailure }> {
  const committed = await runtime.committer.commitToolResults({
    sessionId: input.run.sessionId,
    runId: input.run.runId,
    results,
  });
  // Every really saved ToolResult is a real Session fact: it always gets its
  // own message.started/message.ended pair, even when a later commit fails.
  // Unsaved results never publish Message events.
  const byId = new Map(results.map((result) => [result.toolCallId, result]));
  for (const item of committed.items) {
    const result = byId.get(item.toolCallId);
    emitEvent(dependencies, runtime, 'message.started', {
      role: 'tool_result',
      messageId: item.messageId,
    });
    emitEvent(dependencies, runtime, 'message.ended', {
      role: 'tool_result',
      messageId: item.messageId,
      content: result?.content ?? '',
    });
  }
  if (committed.status === 'failed') {
    // The Agent Loop decides how the Run converges; a failed commit only
    // reports the Session error back after the real facts were published.
    return { status: 'failed', failure: sessionFailure(committed.failure.message) };
  }
  return 'committed';
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
  const reply = await runtime.committer.commitAssistantReply({
    sessionId: input.run.sessionId,
    runId: input.run.runId,
    status: 'cancelled',
    content,
    reasonCode: 'user_cancelled',
    // Reuse the streaming identity when a message lifecycle was started;
    // otherwise the committer settles a fresh cancelled reply for the Run.
    messageId: runtime.activeModelMessageId,
    completedAt: dependencies.clock.now(),
  });
  if (reply.status === 'saved') {
    if (runtime.messageLifecycleOpen) {
      // Streaming identity: its started event was already published; close it
      // exactly once with the projected content.
      closeMessageLifecycle(dependencies, runtime, reply.messageId, partial.text);
    } else if (runtime.activeModelMessageId === undefined) {
      // Fresh identity (the Turn never started): the new real Session Message
      // gets the complete lifecycle pair.
      emitEvent(dependencies, runtime, 'message.started', {
        role: 'assistant',
        messageId: reply.messageId,
      });
      emitEvent(dependencies, runtime, 'message.ended', {
        role: 'assistant',
        messageId: reply.messageId,
        content: partial.text,
      });
    }
    // A streaming identity whose lifecycle already ended (tool batch cancel)
    // must not get a second ended event.
  } else {
    // Nothing was saved; close any still-open streaming lifecycle instead.
    closeMessageLifecycle(dependencies, runtime, runtime.activeModelMessageId ?? '', partial.text);
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

// ---------------------------------------------------------------------------
// Events, failures and helpers
// ---------------------------------------------------------------------------

/**
 * Closes an open assistant Message lifecycle exactly once. The Agent Loop is
 * the only place these decisions live; runners and the committer never emit
 * them.
 */
function closeMessageLifecycle(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  messageId: string,
  content: string,
): void {
  if (!runtime.messageLifecycleOpen) return;
  runtime.messageLifecycleOpen = false;
  emitEvent(dependencies, runtime, 'message.ended', {
    role: 'assistant',
    messageId,
    content,
  });
}

/** Closes an open Turn lifecycle exactly once. */
function closeTurnLifecycle(
  dependencies: AgentLoopDependencies,
  runtime: LoopRuntime,
  stopReason: 'completed' | 'tool_calls' | 'error' | 'cancelled',
  messageId: string,
  toolCallIds: readonly string[],
): void {
  if (!runtime.turnLifecycleOpen) return;
  runtime.turnLifecycleOpen = false;
  emitEvent(dependencies, runtime, 'turn.ended', {
    stopReason,
    messageId,
    toolCallIds: [...toolCallIds],
  });
}

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

/** Converts a ModelCall failure to a RunFailure only when the loop terminates the Run. */
function modelCallRunFailure(failure: ModelCallFailure): RunFailure {
  return {
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    cause: { owner: failure.owner, code: failure.causeCode },
  };
}

/** Converts a ToolCall batch failure to a RunFailure only when the loop terminates the Run. */
function toolCallRunFailure(failure: ToolCallFailure): RunFailure {
  return {
    code: failure.code,
    message: failure.message,
    retryable: false,
    cause: { owner: failure.owner, code: failure.causeCode },
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

