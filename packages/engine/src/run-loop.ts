/*
 * Owns one Run's in-process execution state, event segments, semantic commits,
 * model/tool loop, approval continuation, and cancellation convergence.
 */
import type { Api, AssistantMessage, Model, Tool } from '@megumi/ai';
import type { EffectiveInstructions } from '@megumi/instructions';
import type {
  ContextFailure,
  ModelCallContext,
  Prompt,
  RunContext,
} from '@megumi/context';
import {
  createRuntimeEvent,
  type RuntimeError,
  type RuntimeEvent,
  type RuntimeEventPayloadByType,
  type RuntimeEventType,
} from '@megumi/events';
import type { PermissionMode } from '@megumi/permissions';
import type {
  SessionEntry,
  SessionMessageWithAttachments,
} from '@megumi/session';
import type { ToolDefinition } from '@megumi/tools';
import { skillsFailureMessage, type SkillView } from '@megumi/skills';
import type { UserInput } from '@megumi/input';
import type {
  ObservabilitySpanName,
  TraceHandle,
  SpanHandle,
} from '@megumi/observability';
import type { AssistantContentBlock, JsonObject, JsonValue } from '@megumi/ai';
import type {
  ApprovalDecision,
} from '@megumi/permissions';
import type {
  CreateEngineOptions,
  RunApproval,
} from './engine';
import type { ActiveRunStore } from './active-run-store';
import {
  executeModelCall,
  type ModelCallEvent,
} from './model-call';
import {
  processToolCalls,
  resumeToolCallApproval,
  type ToolCall,
  type ToolCallApprovalContinuation,
  type ToolExecution,
  type ToolResult,
} from './tool-call';
import {
  isTerminalRunStatus,
  transitionRun,
  type Run,
  type RunFailure,
} from './run';
import {
  modelCallFailureToRuntimeError,
  runFailureToRuntimeError,
  toolResultErrorToRuntimeError,
} from './runtime-error-mapping';

const STREAM_DELTA_EVENT_TYPES = new Set<RuntimeEventType>([
  'model_call.text_delta',
  'model.thinking.delta',
  'assistant.output.delta',
]);

export interface RuntimeEventSegment {
  readonly events: AsyncIterable<RuntimeEvent>;
  push(event: RuntimeEvent): void;
  close(): void;
}

export interface EngineRunRuntime {
  readonly controller: AbortController;
  readonly userInput: UserInput;
  readonly runId: string;
  readonly userEntryId: string;
  lastCommittedEntryId: string;
  eventSequence: number;
  modelCallCount: number;
  toolRoundCount: number;
  toolCallCount: number;
  readonly toolExecutionIds: Set<string>;
  readonly committedToolCallIds: Set<string>;
  currentSegment?: RuntimeEventSegment;
  activeTask?: Promise<unknown>;
  activeModelCallId?: string;
  currentToolModelCallId?: string;
  activeModelSpan?: SpanHandle;
  activeModelResponseMessageId?: string;
  currentToolRoundCalls: readonly ToolCall[];
  pendingToolCalls: readonly ToolCall[];
  trace?: TraceHandle;
  rootSpan?: SpanHandle;
  approvalSpan?: SpanHandle;
  readonly toolSpans: Map<string, SpanHandle>;
  observabilityEnded: boolean;
  cancelledReplyCommitted: boolean;
}

export interface RunLoopDependencies extends CreateEngineOptions {
  readonly store: ActiveRunStore;
}

export function createEngineRunRuntime(input: {
  readonly run: Run;
  readonly userMessage: SessionMessageWithAttachments;
  readonly userEntry: SessionEntry;
  readonly userInput: UserInput;
}): EngineRunRuntime {
  return {
    controller: new AbortController(),
    userInput: snapshot(input.userInput),
    runId: input.run.runId,
    userEntryId: input.userEntry.entry_id,
    lastCommittedEntryId: input.userEntry.entry_id,
    eventSequence: 0,
    modelCallCount: 0,
    toolRoundCount: 0,
    toolCallCount: 0,
    toolExecutionIds: new Set(),
    committedToolCallIds: new Set(),
    currentToolRoundCalls: [],
    pendingToolCalls: [],
    toolSpans: new Map(),
    observabilityEnded: false,
    cancelledReplyCommitted: false,
  };
}

export function createRuntimeEventSegment(capacity: number): RuntimeEventSegment {
  const queued: RuntimeEvent[] = [];
  const waiters: Array<(value: IteratorResult<RuntimeEvent>) => void> = [];
  let closed = false;

  const push = (event: RuntimeEvent) => {
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }
    if (queued.length >= capacity) {
      if (STREAM_DELTA_EVENT_TYPES.has(event.eventType as RuntimeEventType)) return;
      const replaceable = queued.findIndex((candidate) => (
        STREAM_DELTA_EVENT_TYPES.has(candidate.eventType as RuntimeEventType)
      ));
      if (replaceable >= 0) queued.splice(replaceable, 1);
    }
    if (queued.length < capacity) queued.push(event);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    while (waiters.length > 0) {
      waiters.shift()?.({ value: undefined as never, done: true });
    }
  };

  return {
    push,
    close,
    events: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (queued.length > 0) {
            yield queued.shift()!;
            continue;
          }
          if (closed) return;
          const next = await new Promise<IteratorResult<RuntimeEvent>>((resolve) => {
            waiters.push(resolve);
          });
          if (next.done) return;
          yield next.value;
        }
      },
    },
  };
}

export function eventSegmentCapacity(options: CreateEngineOptions): number {
  const lifecycleUpperBound = 32
    + options.policy.maxModelCallsPerRun
      * (6 + options.policy.maxModelCallAttempts * 5)
    + options.policy.maxToolCallsPerRun * 9;
  return Math.max(32, lifecycleUpperBound);
}

export function attachRuntimeEventSegment(
  runtime: EngineRunRuntime,
  segment: RuntimeEventSegment,
): void {
  runtime.currentSegment?.close();
  runtime.currentSegment = segment;
}

export function emitRunStarted(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  run: Run,
): void {
  emitEvent(dependencies, runtime, run, 'run.started', {
    providerId: String(run.model.provider),
    modelId: run.model.id,
    runKind: 'agent',
  });
}

export function startRunObservability(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  run: Run,
): void {
  if (!dependencies.observability) return;
  try {
    const trace = dependencies.observability.startTrace({
      traceId: run.runId,
      name: 'agent_run',
      runId: run.runId,
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      requestId: run.requestId,
      attributes: {
        providerId: String(run.model.provider),
        modelId: run.model.id,
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

export function launchRunLoop(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
): void {
  const task = runInRootObservabilityContext(
    dependencies,
    runtime,
    () => executeRunLoop(dependencies, runtime),
  );
  runtime.activeTask = task;
  void task.finally(() => {
    if (runtime.activeTask === task) runtime.activeTask = undefined;
  });
}

interface ContinueRunAfterApprovalInput {
  readonly dependencies: RunLoopDependencies;
  readonly runtime: EngineRunRuntime;
  readonly runApprovalId: string;
  readonly decision: ApprovalDecision;
  readonly onRunResumed?: (run: Run) => void;
  readonly claimedApproval: import('./active-run-store').ClaimedRunApproval<
    ToolCallApprovalContinuation
  >;
}

export async function continueRunAfterApproval(
  input: ContinueRunAfterApprovalInput,
): Promise<
  { readonly status: 'continued' }
  | { readonly status: 'failed'; readonly failure: RunFailure }
> {
  try {
    return await runInRootObservabilityContext(
      input.dependencies,
      input.runtime,
      () => continueRunAfterApprovalInContext(input),
    );
  } catch {
    const failure: RunFailure = {
      code: 'internal_error',
      message: 'Run approval continuation failed unexpectedly.',
      retryable: false,
      cause: { owner: 'engine', code: 'approval_continuation_failed' },
    };
    await failRun(input.dependencies, input.runtime, failure);
    return { status: 'failed', failure };
  }
}

async function continueRunAfterApprovalInContext(
  input: ContinueRunAfterApprovalInput,
): Promise<
  { readonly status: 'continued' }
  | { readonly status: 'failed'; readonly failure: RunFailure }
> {
  const { dependencies, runtime } = input;
  const toolCallbacks = toolExecutionCallbacks(dependencies, runtime);
  const result = await resumeToolCallApproval({
    runApprovalId: input.runApprovalId,
    claimedApproval: input.claimedApproval,
    decision: input.decision,
    store: dependencies.store,
    permissions: dependencies.permissions,
    tools: dependencies.tools,
    ids: dependencies.ids,
    clock: dependencies.clock,
    policy: dependencies.policy,
    signal: runtime.controller.signal,
    onApprovalApplied: (approval) => {
      const waiting = dependencies.store.getRun(approval.runId);
      if (!waiting || waiting.status !== 'waiting') return;
      const running = transitionRun(waiting, {
        status: 'running',
        at: dependencies.clock.now(),
      });
      dependencies.store.updateRun(running);
      endObservedSpan(dependencies, runtime.approvalSpan, 'ok');
      runtime.approvalSpan = undefined;
      emitEvent(dependencies, runtime, running, 'approval.resolved', {
        approvalRequestId: approval.runApprovalId,
        toolCallId: approval.toolCallId,
        decision: resolvedApprovalStatus(approval.status),
        ...(approval.decision?.decision === 'approved'
          ? { optionId: approval.decision.optionId }
          : {}),
        decidedAt: approval.decidedAt ?? dependencies.clock.now(),
      });
      emitEvent(dependencies, runtime, running, 'run.resumed', {
        runApprovalId: approval.runApprovalId,
      });
      input.onRunResumed?.(running);
    },
    ...toolCallbacks,
  });

  if (result.status === 'failed') {
    const latest = dependencies.store.getRunApproval(input.runApprovalId);
    if (latest?.approval.status === 'cancelled' && runtime.controller.signal.aborted) {
      return { status: 'continued' };
    }
    await failRun(dependencies, runtime, result.failure);
    return { status: 'failed', failure: result.failure };
  }
  if (result.status !== 'resumed') {
    const failure: RunFailure = {
      code: 'runtime_protocol_violation',
      message: `RunApproval could not be resumed: ${result.status}.`,
      retryable: false,
      cause: { owner: 'engine', code: 'approval_resume_invalid' },
    };
    await failRun(dependencies, runtime, failure);
    return { status: 'failed', failure };
  }

  if (!await commitNewToolResults(dependencies, runtime, result.toolResults)) {
    return {
      status: 'failed',
      failure: {
        code: 'session_failed',
        message: 'Tool results could not be committed.',
        retryable: false,
        cause: { owner: 'session', code: 'tool_result_commit_failed' },
      },
    };
  }
  runtime.pendingToolCalls = result.remainingToolCalls;
  if (runtime.controller.signal.aborted) {
    await finishCancellationIfStopped(dependencies, runtime);
    return { status: 'continued' };
  }
  if (result.remainingToolCalls.length > 0) {
    const batch = await processToolBatch(dependencies, runtime, result.remainingToolCalls);
    if (batch !== 'completed') return { status: 'continued' };
  }
  releaseCurrentToolRouter(dependencies, runtime);
  runtime.currentToolRoundCalls = [];
  runtime.activeModelResponseMessageId = undefined;
  launchRunLoop(dependencies, runtime);
  return { status: 'continued' };
}

export function requestRunCancellation(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  run: Run,
): void {
  const cancelRequestId = dependencies.ids.createRuntimeEventId();
  emitEvent(dependencies, runtime, run, 'run.cancel.requested', {
    cancelRequestId,
    requestedBy: 'user',
    reason: 'user_cancelled',
    scope: 'run',
  });
  emitEvent(dependencies, runtime, run, 'run.cancelling', { cancelRequestId });
  const approval = pendingApprovalForRun(dependencies.store, run.runId);
  if (approval) {
    const cancelled = dependencies.store.cancelPendingRunApproval({
      runId: run.runId,
      cancelledAt: dependencies.clock.now(),
    });
    if (cancelled) {
      emitEvent(dependencies, runtime, run, 'approval.resolved', {
        approvalRequestId: cancelled.runApprovalId,
        toolCallId: cancelled.toolCallId,
        decision: 'cancelled',
        decidedAt: cancelled.decidedAt ?? dependencies.clock.now(),
      });
    }
  }
  runtime.controller.abort();
  void convergeCancellation(dependencies, runtime);
}

async function executeRunLoop(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
): Promise<void> {
  try {
    while (true) {
      const run = dependencies.store.getRun(runtime.runId);
      if (!run || isTerminalRunStatus(run.status) || run.status === 'waiting') return;
      if (run.status === 'cancelling' || runtime.controller.signal.aborted) {
        await finishCancellationIfStopped(dependencies, runtime);
        return;
      }
      if (runtime.modelCallCount >= dependencies.policy.maxModelCallsPerRun) {
        await failRun(dependencies, runtime, loopLimitFailure('ModelCall limit reached.'));
        return;
      }

      const modelCallId = dependencies.ids.createModelCallId();
      const runContext: RunContext = {
        runId: run.runId,
        sessionId: run.sessionId,
        workspaceId: run.workspaceId,
        userInput: runtime.userInput,
        model: run.model,
      };

      // Workspace -> ExecutionEnvironment (fixed before this ModelCall).
      const environmentResult = dependencies.scopeResolver.resolve({ workspaceId: run.workspaceId });
      if (runtime.controller.signal.aborted) {
        await finishCancellationIfStopped(dependencies, runtime);
        return;
      }
      if (environmentResult.status === 'failed') {
        await failRun(dependencies, runtime, {
          code: 'context_failed',
          message: environmentResult.failure.message,
          retryable: true,
          cause: { owner: 'workspace', code: environmentResult.failure.code },
        });
        return;
      }

      // Instructions -> EffectiveInstructions (fixed before this ModelCall).
      let effectiveInstructions: EffectiveInstructions;
      try {
        const instructions = await dependencies.instructions.getEffectiveInstructions(
          {
            workspaceRoot: environmentResult.workspaceRoot,
            workingDirectory: environmentResult.executionEnvironment.workingDirectory,
          },
          { signal: runtime.controller.signal },
        );
        if (runtime.controller.signal.aborted || instructions.status === 'cancelled') {
          await finishCancellationIfStopped(dependencies, runtime);
          return;
        }
        if (instructions.status === 'failed') {
          await failRun(dependencies, runtime, {
            code: 'context_failed',
            message: instructions.failure.message,
            retryable: true,
            cause: { owner: 'instructions', code: instructions.failure.code },
          });
          return;
        }
        effectiveInstructions = instructions.instructions;
      } catch (error) {
        await failRun(dependencies, runtime, {
          code: 'context_failed',
          message: error instanceof Error ? error.message : 'Effective Instructions could not be resolved.',
          retryable: true,
          cause: { owner: 'instructions', code: 'instructions_resolution_failed' },
        });
        return;
      }

      // Skills -> SkillView (fixed before this ModelCall).
      let skillView: SkillView;
      try {
        const viewResult = await dependencies.skills.createView({
          workspaceId: run.workspaceId,
          signal: runtime.controller.signal,
        });
        if (viewResult.status === 'failed') {
          await failRun(dependencies, runtime, {
            code: 'context_failed',
            message: skillsFailureMessage(viewResult.failure),
            retryable: false,
            cause: { owner: 'skills', code: viewResult.failure.code },
          });
          return;
        }
        skillView = viewResult.view;
      } catch {
        await failRun(dependencies, runtime, {
          code: 'context_failed',
          message: 'Skill View could not be created.',
          retryable: false,
          cause: { owner: 'skills', code: 'skill_view_failed' },
        });
        return;
      }

      // Tools -> ToolView (fixed before this ModelCall).
      let toolResolution;
      try {
        toolResolution = dependencies.tools.resolveModelCallTools({
          runId: run.runId,
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
          modelCallId,
        });
      } catch {
        await failRun(dependencies, runtime, {
          code: 'context_failed',
          message: 'Tool registry is unavailable.',
          retryable: true,
          cause: { owner: 'tools', code: 'tool_registry_unavailable' },
        });
        return;
      }
      if (toolResolution.status === 'failed') {
        await failRun(dependencies, runtime, {
          code: 'context_failed',
          message: toolResolution.failure.message,
          retryable: true,
          cause: { owner: 'tools', code: toolResolution.failure.code },
          details: { toolResolutionCode: toolResolution.failure.code },
        });
        return;
      }
      runtime.currentToolModelCallId = modelCallId;

      const modelCallContext: ModelCallContext = {
        modelCallId,
        run: runContext,
        executionEnvironment: environmentResult.executionEnvironment,
        effectiveInstructions,
        skills: skillView,
        tools: { definitions: toolResolution.definitions },
      };

      const buildPrompt = async (): Promise<
        { readonly status: 'ok'; readonly prompt: Prompt }
        | { readonly status: 'failed'; readonly failure: ContextFailure }
      > => {
        const contextSpan = startObservedSpan(dependencies, runtime, 'context.build');
        try {
          const built = await dependencies.context.build({ modelCallContext, signal: runtime.controller.signal });
          endObservedSpan(dependencies, contextSpan, built.status === 'ready' ? 'ok' : 'error');
          return built.status === 'ready'
            ? { status: 'ok', prompt: built.prompt }
            : { status: 'failed', failure: built.failure };
        } catch (error) {
          endObservedSpan(dependencies, contextSpan, 'error');
          throw error;
        }
      };

      let prompt: Prompt;
      const initialBuild = await buildPrompt();
      if (initialBuild.status === 'failed') {
        await failRun(dependencies, runtime, {
          code: 'context_failed',
          message: initialBuild.failure.message,
          retryable: initialBuild.failure.retryable,
          cause: { owner: 'context', code: initialBuild.failure.code },
        });
        return;
      }
      prompt = initialBuild.prompt;
      const runAfterContext = dependencies.store.getRun(run.runId);
      if (!runAfterContext || isTerminalRunStatus(runAfterContext.status)) return;
      if (runAfterContext.status === 'cancelling' || runtime.controller.signal.aborted) {
        await finishCancellationIfStopped(dependencies, runtime);
        return;
      }

      runtime.modelCallCount += 1;
      runtime.activeModelCallId = modelCallId;
      const modelSpan = startObservedSpan(dependencies, runtime, 'model.call');
      runtime.activeModelSpan = modelSpan;
      let terminal: Extract<ModelCallEvent, { type: 'completed' | 'failed' | 'context_overflow' }> | undefined;
      const retryIds = new Map<number, string>();
      let overflowRecoveryUsed = false;
      let startAttemptNumber = 1;
      while (true) {
        terminal = undefined;
        retryIds.clear();
        for await (const event of executeModelCall({
          modelCallId,
          runId: run.runId,
          sessionId: run.sessionId,
          models: dependencies.models,
          model: run.model,
          context: prompt,
          ...(startAttemptNumber > 1 ? { startAttemptNumber } : {}),
          signal: runtime.controller.signal,
          policy: dependencies.policy,
          clock: dependencies.clock,
        })) {
          // A logical ModelCall publishes exactly one model_call.started; the
          // Overflow recovery reuses the same ModelCall without a second lifecycle event.
          if (event.type !== 'started' || startAttemptNumber === 1) {
            emitModelCallEvent(dependencies, runtime, run, event, retryIds);
          }
          if (event.type === 'completed' || event.type === 'failed' || event.type === 'context_overflow') {
            terminal = event;
          }
        }
        if (!terminal) {
          await failRun(dependencies, runtime, {
            code: 'runtime_protocol_violation',
            message: 'ModelCall ended without a terminal result.',
            retryable: false,
            cause: { owner: 'engine', code: 'model_call_missing_terminal' },
          });
          return;
        }
        if (terminal.type !== 'context_overflow') break;

        // One Overflow compaction recovery per logical ModelCall.
        if (overflowRecoveryUsed) {
          await failRun(dependencies, runtime, {
            code: 'context_failed',
            message: 'ModelCall overflowed the Context Window even after compaction recovery.',
            retryable: false,
            cause: { owner: 'context', code: 'context_window_exceeded' },
          });
          return;
        }
        overflowRecoveryUsed = true;
        if (runtime.controller.signal.aborted) {
          await finishCancellationIfStopped(dependencies, runtime);
          return;
        }
        const compacted = await dependencies.context.compact({
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
          model: run.model,
          trigger: 'overflow',
          executionEnvironment: modelCallContext.executionEnvironment,
          effectiveInstructions: modelCallContext.effectiveInstructions,
          skills: modelCallContext.skills,
          signal: runtime.controller.signal,
        });
        if (compacted.status !== 'compacted') {
          await failRun(dependencies, runtime, {
            code: 'context_failed',
            message: compacted.status === 'failed'
              ? compacted.failure.message
              : 'ModelCall overflowed and compaction had nothing to compact.',
            retryable: false,
            cause: { owner: 'context', code: compacted.status === 'failed' ? compacted.failure.code : 'compaction_failed' },
          });
          return;
        }
        const rebuilt = await buildPrompt();
        if (rebuilt.status === 'failed') {
          await failRun(dependencies, runtime, {
            code: 'context_failed',
            message: rebuilt.failure.message,
            retryable: rebuilt.failure.retryable,
            cause: { owner: 'context', code: rebuilt.failure.code },
          });
          return;
        }
        prompt = rebuilt.prompt;
        startAttemptNumber = terminal.attemptNumber + 1;
      }
      runtime.activeModelCallId = undefined;
      endObservedSpan(
        dependencies,
        modelSpan,
        terminal.type === 'completed'
          ? 'ok'
          : runtime.controller.signal.aborted ? 'cancelled' : 'error',
      );
      runtime.activeModelSpan = undefined;
      if (terminal.type === 'failed') {
        if (runtime.controller.signal.aborted) {
          if (!await commitCancelledPartialReply(
            dependencies,
            runtime,
            terminal.partial.text,
          )) return;
          await finishCancellationIfStopped(dependencies, runtime);
          return;
        }
        await failRun(dependencies, runtime, {
          code: 'model_call_failed',
          message: terminal.failure.message,
          retryable: terminal.failure.retryable,
          cause: { owner: 'ai', code: terminal.failure.code },
        });
        return;
      }

      const runAfterModelCall = dependencies.store.getRun(run.runId);
      if (!runAfterModelCall || isTerminalRunStatus(runAfterModelCall.status)) return;
      if (runAfterModelCall.status === 'cancelling' || runtime.controller.signal.aborted) {
        await finishCancellationIfStopped(dependencies, runtime);
        return;
      }

      const assistantContent = toAssistantContent(terminal.message);
      if (terminal.toolCalls.length === 0) {
        releaseCurrentToolRouter(dependencies, runtime);
        const reply = dependencies.session.saveAssistantReply({
          message_id: dependencies.ids.createSessionMessageId(),
          session_id: runAfterModelCall.sessionId,
          run_id: runAfterModelCall.runId,
          parent_entry_id: runtime.lastCommittedEntryId,
          status: 'completed',
          content: assistantContent,
          reason_code: 'normal_completion',
          ...assistantMetadata(terminal.message),
          completed_at: dependencies.clock.now(),
        });
        if (reply.status === 'failed') {
          await failRun(dependencies, runtime, sessionFailure(reply.failure.message), false);
          return;
        }
        const completed = transitionRun(runAfterModelCall, {
          status: 'completed',
          at: dependencies.clock.now(),
        });
        dependencies.store.updateRun(completed);
        emitEvent(dependencies, runtime, completed, 'run.completed', {
          assistantMessageId: reply.message.message_id,
        });
        finishRuntime(dependencies, runtime, 'ok');
        return;
      }

      if (
        terminal.toolCalls.length > dependencies.policy.maxToolCallsPerModelCall
        || runtime.toolCallCount + terminal.toolCalls.length
          > dependencies.policy.maxToolCallsPerRun
      ) {
        await failRun(dependencies, runtime, loopLimitFailure('ToolCall limit reached.'));
        return;
      }
      if (runtime.toolRoundCount >= dependencies.policy.maxToolRoundsPerRun) {
        await failRun(dependencies, runtime, loopLimitFailure('Tool round limit reached.'));
        return;
      }

      const response = dependencies.session.saveModelResponse({
        message_id: dependencies.ids.createSessionMessageId(),
        session_id: runAfterModelCall.sessionId,
        run_id: runAfterModelCall.runId,
        parent_entry_id: runtime.lastCommittedEntryId,
        content: assistantContent,
        outcome_status: 'completed',
        stop_reason: terminal.message.stopReason,
        ...assistantMetadata(terminal.message),
        completed_at: dependencies.clock.now(),
      });
      if (response.status === 'failed') {
        await failRun(dependencies, runtime, sessionFailure(response.failure.message), false);
        return;
      }
      runtime.lastCommittedEntryId = response.entry.entry_id;
      runtime.toolCallCount += terminal.toolCalls.length;
      runtime.toolRoundCount += 1;
      runtime.activeModelResponseMessageId = response.message.message_id;
      runtime.currentToolRoundCalls = terminal.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        modelCallId: call.sourceModelCallId,
        callOrder: call.callOrder,
        toolName: call.toolName,
        input: call.input,
      }));
      runtime.pendingToolCalls = runtime.currentToolRoundCalls;
      for (const call of runtime.pendingToolCalls) {
        emitEvent(dependencies, runtime, run, 'tool_call.requested', {
          modelCallId: call.modelCallId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: toJsonValue(call.input),
        });
      }
      const batch = await processToolBatch(dependencies, runtime, runtime.pendingToolCalls);
      if (batch !== 'completed') return;
      releaseCurrentToolRouter(dependencies, runtime);
      runtime.currentToolRoundCalls = [];
      runtime.activeModelResponseMessageId = undefined;
    }
  } catch {
    const latest = dependencies.store.getRun(runtime.runId);
    if (!latest || isTerminalRunStatus(latest.status)) return;
    if (latest.status === 'cancelling' || runtime.controller.signal.aborted) {
      return;
    }
    await failRun(dependencies, runtime, {
      code: 'internal_error',
      message: 'Engine failed unexpectedly.',
      retryable: false,
      cause: { owner: 'engine', code: 'unexpected_exception' },
    });
  }
}

async function processToolBatch(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  calls: readonly ToolCall[],
): Promise<'completed' | 'waiting' | 'failed'> {
  const run = dependencies.store.getRun(runtime.runId);
  if (!run || isTerminalRunStatus(run.status)) return 'failed';
  const result = await processToolCalls({
    runId: run.runId,
    sessionId: run.sessionId,
    workspaceId: run.workspaceId,
    permissionMode: run.permissionMode,
    toolCalls: calls,
    permissions: dependencies.permissions,
    tools: dependencies.tools,
    store: dependencies.store,
    ids: dependencies.ids,
    clock: dependencies.clock,
    policy: dependencies.policy,
    signal: runtime.controller.signal,
    ...toolExecutionCallbacks(dependencies, runtime),
  });
  if (!await commitNewToolResults(dependencies, runtime, result.toolResults)) {
    return 'failed';
  }
  if (result.status === 'failed') {
    await failRun(dependencies, runtime, result.failure);
    return 'failed';
  }
  if (result.status === 'waiting') {
    runtime.pendingToolCalls = result.remainingToolCalls;
    const current = dependencies.store.getRun(run.runId);
    if (!current || current.status !== 'running') return 'failed';
    const waiting = transitionRun(current, {
      status: 'waiting',
      at: dependencies.clock.now(),
    });
    dependencies.store.updateRun(waiting);
    emitApprovalRequested(dependencies, runtime, waiting, result.approval);
    runtime.approvalSpan = startObservedSpan(dependencies, runtime, 'approval.wait');
    emitEvent(dependencies, runtime, waiting, 'run.waiting', {
      approvalRequestId: result.approval.runApprovalId,
      toolCallId: result.approval.toolCallId,
      reason: 'approval_required',
    });
    runtime.currentSegment?.close();
    runtime.currentSegment = undefined;
    return 'waiting';
  }
  runtime.pendingToolCalls = [];
  if (runtime.controller.signal.aborted) {
    await finishCancellationIfStopped(dependencies, runtime);
    return 'failed';
  }
  return 'completed';
}

async function commitNewToolResults(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  results: readonly ToolResult[],
): Promise<boolean> {
  for (const result of [...results].sort((left, right) => left.callOrder - right.callOrder)) {
    if (runtime.committedToolCallIds.has(result.toolCallId)) continue;
    const run = dependencies.store.getRun(runtime.runId);
    if (!run || isTerminalRunStatus(run.status)) return false;
    const saved = dependencies.session.saveToolResultMessage({
      message_id: dependencies.ids.createSessionMessageId(),
      session_id: run.sessionId,
      run_id: run.runId,
      parent_entry_id: runtime.lastCommittedEntryId,
      tool_call_id: result.toolCallId,
      tool_name: result.toolName,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
      content: [{ type: 'text', text: result.content }],
      completed_at: result.completedAt,
    });
    if (saved.status === 'failed') {
      await failRun(dependencies, runtime, sessionFailure(saved.failure.message), false);
      return false;
    }
    runtime.committedToolCallIds.add(result.toolCallId);
    runtime.lastCommittedEntryId = saved.entry.entry_id;
      emitEvent(dependencies, runtime, run, 'tool_result.created', {
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      kind: result.status,
      content: [{ type: 'text', text: result.content }],
      ...(result.status === 'success' && result.observation?.summary
        ? { summary: result.observation.summary }
        : {}),
      ...(result.error ? { error: toEventError(result.error) } : {}),
    });
  }
  return true;
}

function toolExecutionCallbacks(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
): Pick<
  Parameters<typeof processToolCalls>[0],
  'onToolExecutionStarted' | 'onToolExecutionFinished' | 'onToolExecutionOutput' | 'onToolExecutionNotification'
> {
  return {
    onToolExecutionStarted: (execution) => {
      runtime.toolExecutionIds.add(execution.toolExecutionId);
      const run = dependencies.store.getRun(execution.runId);
      if (!run || isTerminalRunStatus(run.status)) return;
      const span = startObservedSpan(dependencies, runtime, 'tool.call');
      if (span) runtime.toolSpans.set(execution.toolExecutionId, span);
      emitEvent(dependencies, runtime, run, 'tool.execution.started', {
        toolExecutionId: execution.toolExecutionId,
        startedAt: execution.startedAt,
      });
    },
    onToolExecutionOutput: (execution, output) => {
      const run = dependencies.store.getRun(execution.runId);
      if (!run || isTerminalRunStatus(run.status)) return;
      emitEvent(dependencies, runtime, run, 'tool.execution.output', {
        toolExecutionId: execution.toolExecutionId,
        stream: output.stream,
        delta: output.chunk,
        truncated: output.truncated,
      });
    },
    onToolExecutionNotification: (execution, notification) => {
      const run = dependencies.store.getRun(execution.runId);
      if (!run || isTerminalRunStatus(run.status)) return;
      if (notification.type === 'plan_updated') {
        emitEvent(dependencies, runtime, run, 'run.plan.updated', {
          toolCallId: execution.toolCallId,
          ...(notification.explanation ? { explanation: notification.explanation } : {}),
          plan: notification.plan,
        });
      }
    },
    onToolExecutionFinished: (execution, result) => {
      endObservedSpan(
        dependencies,
        runtime.toolSpans.get(execution.toolExecutionId),
        execution.status === 'succeeded'
          ? 'ok'
          : execution.status === 'cancelled' ? 'cancelled' : 'error',
      );
      runtime.toolSpans.delete(execution.toolExecutionId);
      const run = dependencies.store.getRun(execution.runId);
      if (!run || isTerminalRunStatus(run.status)) return;
      if (execution.status === 'succeeded') {
        emitEvent(dependencies, runtime, run, 'tool.execution.completed', {
          toolExecutionId: execution.toolExecutionId,
          completedAt: execution.completedAt,
        });
        return;
      }
      if (execution.status === 'cancelled') {
        const call = findToolCall(runtime, execution.toolCallId);
        if (!runtime.activeModelResponseMessageId || !call) return;
        emitEvent(dependencies, runtime, run, 'tool.execution.cancelled', {
          assistantMessageId: runtime.activeModelResponseMessageId,
          toolExecutionId: execution.toolExecutionId,
          toolCallId: execution.toolCallId,
          toolName: result.toolName,
          callOrder: call.callOrder,
          status: 'cancelled',
        });
        return;
      }
      emitEvent(dependencies, runtime, run, 'tool.execution.failed', {
        toolExecutionId: execution.toolExecutionId,
        error: toolResultErrorToRuntimeError(result.error ?? {
          code: 'tool_execution_failed',
          message: 'Tool execution failed.',
        }),
        completedAt: execution.completedAt,
      });
    },
  };
}

function emitModelCallEvent(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  run: Run,
  event: ModelCallEvent,
  retryIds: Map<number, string>,
): void {
  if (event.type === 'started') {
    emitEvent(dependencies, runtime, run, 'model_call.started', {
      modelCallId: event.modelCall.modelCallId,
      providerId: String(run.model.provider),
      modelId: run.model.id,
    });
    return;
  }
  if (event.type === 'attempt_started') {
    recordObservedLog(dependencies, runtime, {
      level: 'info',
      event: 'model.call.attempt.started',
      attributes: {
        modelCallId: event.modelCallId,
        attemptNumber: event.attemptNumber,
        maxAttempts: event.maxAttempts,
      },
    });
    recordObservedMeasurement(dependencies, runtime, {
      name: 'model.call.attempt',
      value: event.attemptNumber,
      unit: 'count',
      attributes: { modelCallId: event.modelCallId },
    });
    return;
  }
  if (event.type === 'text_delta') {
    emitEvent(dependencies, runtime, run, 'model_call.text_delta', {
      modelCallId: event.modelCallId,
      delta: event.delta,
    });
    return;
  }
  if (event.type === 'projection_reset') {
    emitEvent(dependencies, runtime, run, 'model_call.projection_reset', {
      modelCallId: event.modelCallId,
      failedAttemptNumber: event.failedAttemptNumber,
    });
    return;
  }
  if (event.type === 'context_overflow') {
    // A recoverable Context overflow is not a ModelCall terminal: flush stale
    // stream buffers and record a diagnostic before the Engine compacts and retries.
    emitEvent(dependencies, runtime, run, 'model_call.projection_reset', {
      modelCallId: event.modelCallId,
      failedAttemptNumber: event.attemptNumber,
    });
    recordObservedLog(dependencies, runtime, {
      level: 'warn',
      event: 'model.call.context_overflow',
      attributes: {
        modelCallId: event.modelCallId,
        attemptNumber: event.attemptNumber,
      },
    });
    return;
  }
  if (event.type === 'thinking_started') {
    emitEvent(dependencies, runtime, run, 'model.thinking.started', {
      modelCallId: event.modelCallId,
    });
    return;
  }
  if (event.type === 'thinking_delta') {
    emitEvent(dependencies, runtime, run, 'model.thinking.delta', {
      modelCallId: event.modelCallId,
      delta: event.delta,
    });
    return;
  }
  if (event.type === 'thinking_completed') {
    emitEvent(dependencies, runtime, run, 'model.thinking.completed', {
      modelCallId: event.modelCallId,
    });
    return;
  }
  if (event.type === 'retrying') {
    const retryRequestId = dependencies.ids.createRuntimeEventId();
    retryIds.set(event.nextAttemptNumber, retryRequestId);
    emitEvent(dependencies, runtime, run, 'retry.started', {
      retryRequestId,
      retryKind: 'model_call',
    });
    return;
  }
  if (event.type === 'completed') {
    for (const call of event.toolCalls) {
      emitEvent(dependencies, runtime, run, 'model_call.tool_call', {
        modelCallId: event.modelCall.modelCallId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: toJsonValue(call.input),
      });
    }
    for (const retryRequestId of retryIds.values()) {
      emitEvent(dependencies, runtime, run, 'retry.completed', {
        retryRequestId,
        retryKind: 'model_call',
      });
    }
    emitEvent(dependencies, runtime, run, 'model_call.completed', {
      modelCallId: event.modelCall.modelCallId,
      finishReason: event.toolCalls.length > 0 ? 'tool_calls' : event.message.stopReason,
      content: event.message.content
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map((block) => ({ type: 'text' as const, text: block.text })),
    });
    return;
  }
  if (event.type === 'failed') {
    for (const retryRequestId of retryIds.values()) {
      emitEvent(dependencies, runtime, run, 'retry.failed', {
        retryRequestId,
        retryKind: 'model_call',
        error: modelCallFailureToRuntimeError(event.failure),
      });
    }
    emitEvent(dependencies, runtime, run, 'model_call.completed', {
      modelCallId: event.modelCall.modelCallId,
      finishReason: event.failure.code === 'aborted' ? 'cancelled' : 'failed',
    });
  }
}

function resolvedApprovalStatus(
  status: RunApproval['status'],
): 'approved' | 'denied' | 'cancelled' {
  if (status === 'pending') {
    throw new Error('A pending RunApproval cannot emit approval.resolved.');
  }
  return status;
}

function emitApprovalRequested(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  run: Run,
  approval: RunApproval,
): void {
  emitEvent(dependencies, runtime, run, 'approval.requested', {
    approvalRequest: {
      approvalRequestId: approval.runApprovalId,
      runId: approval.runId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      toolIdentity: {
        sourceId: approval.toolIdentity.sourceId,
        namespace: approval.toolIdentity.namespace,
        sourceToolName: approval.toolIdentity.sourceToolName,
      },
      input: toJsonValue(approval.input),
      operations: approval.operations.map((operation) => (
        toJsonValue(operation) as JsonObject
      )),
      options: approval.options.map((option) => ({
        optionId: option.optionId,
        scope: option.scope,
        display: { ...option.display },
        effect: toJsonValue(option.effect) as JsonObject,
      })),
      defaultOptionId: approval.defaultOptionId,
      status: approval.status,
      createdAt: approval.createdAt,
      ...(approval.summary ? { summary: approval.summary } : {}),
      ...(approval.preview
        ? {
            preview: {
              action: approval.preview.action,
              targets: approval.preview.targets.map((target) => ({ ...target })),
            },
          }
        : {}),
    },
  });
}

function emitEvent<TType extends RuntimeEventType>(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  run: Run,
  eventType: TType,
  payload: RuntimeEventPayloadByType[TType],
): void {
  const event = createRuntimeEvent({
    eventId: dependencies.ids.createRuntimeEventId(),
    eventType,
    runId: run.runId,
    sessionId: run.sessionId,
    workspaceId: run.workspaceId,
    requestId: run.requestId,
    sequence: ++runtime.eventSequence,
    createdAt: dependencies.clock.now(),
    source: eventSource(eventType),
    visibility: eventVisibility(eventType),
    persist: 'transient',
    payload,
  });
  runtime.currentSegment?.push(event);
  try {
    const publication = dependencies.events.publish({ event });
    if (publication && typeof publication.then === 'function') {
      void publication.catch(() => undefined);
    }
  } catch {
    // Live event delivery is diagnostic/projection work and cannot change Run outcome.
  }
}

async function convergeCancellation(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
): Promise<void> {
  const task = runtime.activeTask;
  if (!task) {
    await finishCancellationIfStopped(dependencies, runtime);
    return;
  }
  const outcome = await raceWithTimeout(task, dependencies.policy.cancellationTimeoutMs);
  const run = dependencies.store.getRun(runtime.runId);
  if (!run || run.status !== 'cancelling') return;
  if (outcome === 'completed') {
    await finishCancellationIfStopped(dependencies, runtime);
    return;
  }
  await failRun(dependencies, runtime, {
    code: 'cancellation_failed',
    message: 'Run cancellation did not converge before the configured deadline.',
    retryable: false,
    cause: { owner: 'engine', code: 'cancellation_timeout' },
    details: {
      activeModelCall: runtime.activeModelCallId !== undefined,
      activeToolExecutionCount: dependencies.store.getActiveToolExecutionIds(run.runId).length,
    },
  }, false);
}

async function finishCancellationIfStopped(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
): Promise<void> {
  let run = dependencies.store.getRun(runtime.runId);
  if (!run || run.status !== 'cancelling') return;
  const activeExecutions = dependencies.store.getActiveToolExecutionIds(run.runId);
  if (activeExecutions.length > 0) return;
  if (!await closeOutstandingToolCalls(dependencies, runtime, {
    status: 'cancelled',
    code: 'tool_cancelled',
    message: 'ToolCall was cancelled before producing a result.',
  })) return;
  run = dependencies.store.getRun(runtime.runId);
  if (!run || run.status !== 'cancelling') return;
  if (!await commitCancelledPartialReply(dependencies, runtime, '')) return;
  const cancelled = transitionRun(run, {
    status: 'cancelled',
    at: dependencies.clock.now(),
  });
  dependencies.store.updateRun(cancelled);
  emitEvent(dependencies, runtime, cancelled, 'run.cancelled', {
    reason: 'user_cancelled',
  });
  finishRuntime(dependencies, runtime, 'cancelled');
}

async function commitCancelledPartialReply(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  text: string,
): Promise<boolean> {
  if (runtime.cancelledReplyCommitted) return true;
  const run = dependencies.store.getRun(runtime.runId);
  if (!run || isTerminalRunStatus(run.status)) return false;
  const saved = dependencies.session.saveAssistantReply({
    message_id: dependencies.ids.createSessionMessageId(),
    session_id: run.sessionId,
    run_id: run.runId,
    parent_entry_id: runtime.lastCommittedEntryId,
    status: 'cancelled',
    content: text ? [{ type: 'text', text }] : [],
    reason_code: 'user_cancelled',
    completed_at: dependencies.clock.now(),
  });
  if (saved.status === 'failed') {
    await failRun(dependencies, runtime, sessionFailure(saved.failure.message), false);
    return false;
  }
  runtime.cancelledReplyCommitted = true;
  return true;
}

async function failRun(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  failure: RunFailure,
  commitReply = true,
): Promise<void> {
  let run = dependencies.store.getRun(runtime.runId);
  if (!run || isTerminalRunStatus(run.status)) return;
  let finalFailure = safeFailure(failure);
  if (failure.code !== 'session_failed') {
    const closed = await closeOutstandingToolCalls(dependencies, runtime, {
      status: 'failure',
      code: 'run_failed_before_tool_result',
      message: 'Run failed before ToolCall produced a result.',
    });
    if (!closed) return;
    run = dependencies.store.getRun(runtime.runId);
    if (!run || isTerminalRunStatus(run.status)) return;
  }
  if (commitReply && failure.code !== 'session_failed') {
    const reply = dependencies.session.saveAssistantReply({
      message_id: dependencies.ids.createSessionMessageId(),
      session_id: run.sessionId,
      run_id: run.runId,
      parent_entry_id: runtime.lastCommittedEntryId,
      status: 'failed',
      content: [],
      reason_code: failureReason(failure),
      completed_at: dependencies.clock.now(),
    });
    if (reply.status === 'failed') finalFailure = sessionFailure(reply.failure.message);
  }
  const failed = transitionRun(run, {
    status: 'failed',
    at: dependencies.clock.now(),
    failure: finalFailure,
  });
  dependencies.store.updateRun(failed);
  emitEvent(dependencies, runtime, failed, 'run.failed', {
    error: runFailureToRuntimeError(finalFailure),
  });
  finishRuntime(dependencies, runtime, 'error');
}

async function closeOutstandingToolCalls(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  closure: {
    readonly status: 'failure' | 'cancelled';
    readonly code: 'run_failed_before_tool_result' | 'tool_cancelled';
    readonly message: string;
  },
): Promise<boolean> {
  const outstanding = runtime.currentToolRoundCalls
    .filter((call) => !runtime.committedToolCallIds.has(call.toolCallId))
    .sort((left, right) => left.callOrder - right.callOrder);
  if (outstanding.length === 0) return true;
  return commitNewToolResults(dependencies, runtime, outstanding.map((call) => ({
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    callOrder: call.callOrder,
    status: closure.status,
    error: {
      code: closure.code,
      message: closure.message,
    },
    content: closure.message,
    completedAt: dependencies.clock.now(),
  })));
}

function finishRuntime(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  status: 'ok' | 'error' | 'cancelled',
): void {
  runtime.currentSegment?.close();
  runtime.currentSegment = undefined;
  endObservedSpan(dependencies, runtime.approvalSpan, status);
  runtime.approvalSpan = undefined;
  endObservedSpan(dependencies, runtime.activeModelSpan, status);
  runtime.activeModelSpan = undefined;
  for (const span of runtime.toolSpans.values()) {
    endObservedSpan(dependencies, span, status);
  }
  runtime.toolSpans.clear();
  if (!runtime.observabilityEnded && dependencies.observability) {
    runtime.observabilityEnded = true;
    endObservedSpan(dependencies, runtime.rootSpan, status);
    try {
      if (runtime.trace) dependencies.observability.endTrace({
        trace: runtime.trace,
        status,
      });
    } catch {
      // Diagnostics never own Run outcome.
    }
  }
  runtime.pendingToolCalls = [];
  runtime.currentToolRoundCalls = [];
  runtime.activeModelResponseMessageId = undefined;
  releaseCurrentToolRouter(dependencies, runtime);
  dependencies.store.releaseRunRuntime(runtime.runId);
}

function releaseCurrentToolRouter(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
): void {
  if (!runtime.currentToolModelCallId) return;
  dependencies.tools.releaseModelCallTools({ modelCallId: runtime.currentToolModelCallId });
  runtime.currentToolModelCallId = undefined;
}

function runInRootObservabilityContext<T>(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  operation: () => T,
): T {
  const observability = dependencies.observability;
  if (!observability) return operation();
  let invoked = false;
  try {
    if (runtime.rootSpan) {
      return observability.runInSpanContext(runtime.rootSpan, () => {
        invoked = true;
        return operation();
      });
    }
    if (runtime.trace) {
      return observability.runInTraceContext(runtime.trace, () => {
        invoked = true;
        return operation();
      });
    }
  } catch (error) {
    if (invoked) throw error;
  }
  return operation();
}

function startObservedSpan(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  name: ObservabilitySpanName,
): SpanHandle | undefined {
  if (!dependencies.observability) return undefined;
  const run = dependencies.store.getRun(runtime.runId);
  try {
    return dependencies.observability.startSpan({
      name,
      correlation: {
        ...(runtime.trace ? { traceId: runtime.trace.traceId } : {}),
        ...(runtime.rootSpan ? { parentSpanId: runtime.rootSpan.spanId } : {}),
        ...(run ? {
          runId: run.runId,
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
          requestId: run.requestId,
        } : {}),
      },
    });
  } catch {
    return undefined;
  }
}

function endObservedSpan(
  dependencies: RunLoopDependencies,
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
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  input: {
    readonly level: 'info' | 'warn' | 'error';
    readonly event: string;
    readonly attributes?: Record<string, unknown>;
  },
): void {
  if (!dependencies.observability) return;
  const run = dependencies.store.getRun(runtime.runId);
  try {
    dependencies.observability.recordLog({
      ...input,
      correlation: observedCorrelation(runtime, run),
    });
  } catch {
    // Diagnostics never own Run outcome.
  }
}

function recordObservedMeasurement(
  dependencies: RunLoopDependencies,
  runtime: EngineRunRuntime,
  input: {
    readonly name: string;
    readonly value: number;
    readonly unit: 'count';
    readonly attributes?: Record<string, unknown>;
  },
): void {
  if (!dependencies.observability) return;
  const run = dependencies.store.getRun(runtime.runId);
  try {
    dependencies.observability.recordMeasurement({
      ...input,
      correlation: observedCorrelation(runtime, run),
    });
  } catch {
    // Diagnostics never own Run outcome.
  }
}

function observedCorrelation(runtime: EngineRunRuntime, run: Run | undefined) {
  return {
    ...(runtime.trace ? { traceId: runtime.trace.traceId } : {}),
    ...(runtime.rootSpan ? { spanId: runtime.rootSpan.spanId } : {}),
    ...(run ? {
      runId: run.runId,
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      requestId: run.requestId,
    } : {}),
  };

;
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

function toAssistantContent(message: AssistantMessage): AssistantContentBlock[] {
  return message.content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'thinking') {
      return { type: 'thinking', thinking: block.thinking };
    }
    return {
      type: 'toolCall',
      id: block.id,
      name: block.name,
      argumentsText: canonicalJson(block.arguments),
    };
  });
}

function findToolCall(runtime: EngineRunRuntime, toolCallId: string): ToolCall | undefined {
  return runtime.currentToolRoundCalls.find((call) => call.toolCallId === toolCallId);
}

function pendingApprovalForRun(
  store: ActiveRunStore,
  runId: string,
): RunApproval | undefined {
  return store.getPendingRunApproval(runId);
}

function eventSource(eventType: RuntimeEventType): 'core' | 'provider' | 'tool' | 'approval' {
  if (eventType.startsWith('model') || eventType.startsWith('retry')) return 'provider';
  if (eventType.startsWith('tool')) return 'tool';
  if (eventType.startsWith('approval')) return 'approval';
  return 'core';
}

function eventVisibility(eventType: RuntimeEventType): 'user' | 'system' | 'debug' {
  if (
    eventType === 'run.failed'
    || eventType === 'run.cancelled'
    || eventType === 'approval.requested'
  ) {
    return 'user';
  }
  return STREAM_DELTA_EVENT_TYPES.has(eventType) ? 'debug' : 'system';
}

function toEventError(error: ToolResult['error']): {
  code: string;
  message: string;
  details?: Record<string, JsonValue>;
} {
  if (!error) return { code: 'tool_execution_failed', message: 'Tool execution failed.' };
  return {
    code: error.code,
    message: error.message,
    ...(error.details ? { details: toJsonValue(error.details) as Record<string, JsonValue> } : {}),
  };
}

function safeFailure(failure: RunFailure): RunFailure {
  return {
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    ...(failure.cause ? { cause: { ...failure.cause } } : {}),
    ...(failure.details ? { details: snapshot(failure.details) } : {}),
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

function sessionFailure(message: string): RunFailure {
  return { code: 'session_failed', message, retryable: false, cause: { owner: 'session', code: 'session_failed' } };
}

function loopLimitFailure(message: string): RunFailure {
  return { code: 'loop_limit_exceeded', message, retryable: false, cause: { owner: 'engine', code: 'loop_limit_exceeded' } };
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: [...value] };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  return null;
}

function snapshot<T>(value: T): T {
  return structuredClone(value);
}

function raceWithTimeout(
  task: Promise<unknown>,
  timeoutMs: number,
): Promise<'completed' | 'timed_out'> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: 'completed' | 'timed_out') => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => finish('timed_out'), timeoutMs);
    void task.then(
      () => finish('completed'),
      () => finish('completed'),
    );
  });
}
