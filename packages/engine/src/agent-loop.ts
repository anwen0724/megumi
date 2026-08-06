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
      clock: dependencies.clock,
    }),
    modelCallCount: 0,
    toolRoundCount: 0,
    toolCallCount: 0,
    projection: { text: '', thinking: '' },
    observer: createLoopObserver({
      run: input.run,
      observability: dependencies.observability,
    }),
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
    return await failRun({
      code: 'internal_error',
      message: error instanceof Error ? error.message : 'Engine failed unexpectedly.',
      retryable: false,
      cause: { owner: 'engine', code: 'unexpected_exception' },
    });
  } finally {
    runtime.observer.end('ok');
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
    runtime.projection.text = '';
    runtime.projection.thinking = '';
    emitEvent(dependencies, runtime, 'turn.started', { messageId: runtime.activeModelMessageId });
    emitEvent(dependencies, runtime, 'message.started', {
      role: 'assistant',
      messageId: runtime.activeModelMessageId,
    });
    runtime.modelCallCount += 1;

    const modelSpan = runtime.observer.startSpan('model.call');
    let modelOutcome: ModelCallOutcome;
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
          runId: input.run.runId,
          sessionId: input.run.sessionId,
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
      runtime.observer.endSpan(modelSpan, input.signal.aborted ? 'cancelled' : 'ok');
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
        content: runtime.projection.text,
      });
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'error',
        messageId: runtime.activeModelMessageId ?? '',
        toolCallIds: [],
      });
      return await failRun(modelCallRunFailure(modelOutcome.failure));
    }

    const assistantContent = toAssistantContent(modelOutcome.message);
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
        return await failRun(sessionFailure(reply.failure.message));
      }
      emitEvent(dependencies, runtime, 'message.ended', {
        role: 'assistant',
        messageId: reply.messageId,
        content: assistantContent
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      });
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'completed',
        messageId: reply.messageId,
        toolCallIds: [],
      });
      return { status: 'completed', assistantMessageId: reply.messageId };
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
      return await failRun(sessionFailure(response.failure.message));
    }
    emitEvent(dependencies, runtime, 'message.ended', {
      role: 'assistant',
      messageId: response.messageId,
      content: assistantContent
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
    });
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
        runId: input.run.runId,
        sessionId: input.run.sessionId,
        publish: (type, payload) => emitEvent(dependencies, runtime, type, payload),
      },
      observation: {
        startSpan: () => runtime.observer.startSpan('tool.call'),
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
        const approvalSpan = runtime.observer.startSpan('approval.wait');
        let resolution: ApprovalResolution;
        try {
          resolution = await approvalWait;
        } finally {
          runtime.observer.endSpan(approvalSpan, 'ok');
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
        emitEvent(dependencies, runtime, 'turn.ended', {
          stopReason: 'cancelled',
          messageId: messageId,
          toolCallIds: modelOutcome.toolCalls.map((call) => call.toolCallId),
        });
        return cancelledResult();
      }
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'error',
        messageId: messageId,
        toolCallIds: modelOutcome.toolCalls.map((call) => call.toolCallId),
      });
      return await failRun(committed.failure);
    }
    if (batch.status === 'cancelled') {
      await commitCancelledReply(input, dependencies, runtime, {
        text: runtime.projection.text,
        thinking: runtime.projection.thinking,
      });
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'cancelled',
        messageId: messageId,
        toolCallIds: modelOutcome.toolCalls.map((call) => call.toolCallId),
      });
      return cancelledResult();
    }
    if (batch.status === 'failed') {
      emitEvent(dependencies, runtime, 'turn.ended', {
        stopReason: 'error',
        messageId: messageId,
        toolCallIds: modelOutcome.toolCalls.map((call) => call.toolCallId),
      });
      return await failRun(toolCallRunFailure(batch.failure));
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
  if (committed.status === 'failed') {
    // The Agent Loop decides how the Run converges; a failed commit only
    // reports the Session error back.
    return { status: 'failed', failure: sessionFailure(committed.failure.message) };
  }
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
    emitEvent(dependencies, runtime, 'message.ended', {
      role: 'assistant',
      messageId: reply.messageId,
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
