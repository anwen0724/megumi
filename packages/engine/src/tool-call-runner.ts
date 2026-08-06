/*
 * Executes the ToolCall batch the Agent Loop decided to process: it routes
 * every call through the current modelCallId, asks Permissions, requests
 * approval only through the loop-provided requestApproval() callback, runs
 * the serial/parallel window under the confirmed concurrency limit and forms
 * the complete model-ordered ToolResult[]. It never reads or writes the Run status,
 * never saves Session messages, never decides whether the loop continues or
 * the Run ends, and never holds Tool registration, Permissions or Sandbox
 * rules.
 */
import type { EventPayloadByType, EventType } from '@megumi/events';
import type { ApprovalDecision, PermissionDecision, PermissionMode, PermissionOperation, Permissions } from '@megumi/permissions';
import type { SpanHandle } from '@megumi/observability';
import type { ToolExecutionAccess, ToolInvocation, Tools } from '@megumi/tools';
import type { RunClock } from './run';
import type { RunPolicy } from './run-policy';
import type { CompletedToolCall } from './model-call-runner';
import type { SessionToolResultCommit } from './session-message-committer';

/** The batch outcome the Agent Loop uses to decide commit, continue or end. */
export type ToolCallBatchOutcome =
  | { readonly status: 'completed'; readonly results: readonly ToolResult[] }
  | { readonly status: 'cancelled'; readonly results: readonly ToolResult[] }
  | { readonly status: 'failed'; readonly failure: ToolCallFailure; readonly results: readonly ToolResult[] };

/**
 * A ToolCall batch system failure keeps its owner and code; whether the Run
 * ends is the Agent Loop's decision. Ordinary Tool failures, permission
 * denials and rejected approvals stay model-visible ToolResults instead.
 */
export interface ToolCallFailure {
  readonly code: 'permission_failed';
  readonly message: string;
  readonly owner: 'permissions';
  readonly causeCode: string;
}

/** The model-visible ToolCall result facts of one batch. */
export interface ToolResult extends SessionToolResultCommit {
  readonly summary?: string;
}

/** The approval resolution returned by the loop-owned requestApproval(). */
export type ApprovalResolution =
  | { readonly status: 'approved'; readonly decision: ApprovalDecision }
  | { readonly status: 'denied'; readonly decision: ApprovalDecision }
  | { readonly status: 'cancelled' };

/** The narrowed Runtime Event publish the runner needs, with fixed correlation. */
export interface ToolCallEventSource {
  readonly runId: string;
  readonly sessionId: string;
  publish<TType extends EventType>(type: TType, payload: EventPayloadByType[TType]): void;
}

/** The narrowed best-effort span surface the runner needs. */
export interface ToolCallObservation {
  startSpan(): SpanHandle | undefined;
  endSpan(span: SpanHandle | undefined, status: 'ok' | 'cancelled'): void;
}

export interface RequestApprovalInput {
  readonly call: CompletedToolCall;
  readonly invocation: ToolInvocation;
  readonly decision: Extract<PermissionDecision, { type: 'requires_approval' }>;
}

export interface RunToolCallBatchRequest {
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly permissionMode: PermissionMode;
  readonly modelCallId: string;
  readonly calls: readonly CompletedToolCall[];
  readonly signal: AbortSignal;
  readonly tools: Pick<Tools, 'routeToolCall' | 'executeToolInvocation'>;
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly policy: Pick<RunPolicy, 'maxConcurrentToolExecutions' | 'toolExecutionTimeoutMs'>;
  readonly ids: { createToolExecutionId(): string };
  readonly clock: RunClock;
  readonly events: ToolCallEventSource;
  readonly observation: ToolCallObservation;
  /** The Agent Loop owns the waiting/running transitions, events and wait. */
  readonly requestApproval: (input: RequestApprovalInput) => Promise<ApprovalResolution>;
}

/**
 * Executes one whole ToolCall batch and returns the complete, model-ordered
 * results; the Agent Loop commits them through the Session Message Committer.
 */
export async function runToolCallBatch(
  request: RunToolCallBatchRequest,
): Promise<ToolCallBatchOutcome> {
  // The model's ToolCall requests are batch facts: publish them before any
  // routing or execution starts.
  for (const call of request.calls) {
    request.events.publish('tool_execution.requested', {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      args: toJsonValue(call.input) as Record<string, unknown>,
      modelCallId: call.sourceModelCallId,
    });
  }
  const results: ToolResult[] = [];
  const recordResult = (result: ToolResult) => {
    results.push(result);
  };
  // Parallel-mode calls accumulate into a window executed concurrently under
  // the confirmed concurrency limit; results commit in model call order.
  let parallelWindow: Array<{ call: CompletedToolCall; invocation: ToolInvocation }> = [];

  const closeWith = (result: (call: CompletedToolCall) => ToolResult, fromIndex: number) => {
    for (const remaining of request.calls.slice(fromIndex)) {
      recordResult(result(remaining));
    }
  };

  const flushParallelWindow = async (): Promise<'completed' | 'cancelled'> => {
    if (parallelWindow.length === 0) return 'completed';
    const window = [...parallelWindow];
    parallelWindow = [];
    if (request.signal.aborted) {
      for (const { call } of window) recordResult(cancelledToolResult(call, request.clock.now()));
      return 'cancelled';
    }
    const concurrency = Math.max(1, request.policy.maxConcurrentToolExecutions);
    const outcomes: Array<{ call: CompletedToolCall; outcome: ToolCallOutcome }> = [];
    for (let index = 0; index < window.length; index += concurrency) {
      const batch = window.slice(index, index + concurrency);
      outcomes.push(...await Promise.all(batch.map(async (entry) => ({
        call: entry.call,
        outcome: await executeToolCallWithPermissions(
          request, entry.call, entry.invocation, [],
        ),
      }))));
    }
    for (const { call, outcome } of outcomes) {
      if (outcome.kind === 'cancelled') {
        recordResult(cancelledToolResult(call, request.clock.now()));
        continue;
      }
      if (outcome.kind === 'failed') {
        recordResult(closedToolResult(call, request.clock.now()));
        continue;
      }
      recordResult(outcome.result);
    }
    if (request.signal.aborted) return 'cancelled';
    return 'completed';
  };

  for (const [index, call] of request.calls.entries()) {
    if (request.signal.aborted) {
      const flushed = await flushParallelWindow();
      closeWith((remaining) => cancelledToolResult(remaining, request.clock.now()), index);
      if (flushed === 'cancelled') {
        for (const pending of parallelWindow) {
          recordResult(cancelledToolResult(pending.call, request.clock.now()));
        }
        parallelWindow = [];
      }
      return { status: 'cancelled', results: [...results] };
    }

    const routed = request.tools.routeToolCall({
      runId: request.runId,
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      modelCallId: request.modelCallId,
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
        completedAt: request.clock.now(),
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
      closeWith((remaining) => cancelledToolResult(remaining, request.clock.now()), index);
      return { status: 'cancelled', results: [...results] };
    }

    const executed = await executeToolCallWithPermissions(
      request,
      call,
      routed.invocation,
      routed.operations,
    );
    if (executed.kind === 'cancelled') {
      recordResult(cancelledToolResult(call, request.clock.now()));
      closeWith((remaining) => cancelledToolResult(remaining, request.clock.now()), index + 1);
      return { status: 'cancelled', results: [...results] };
    }
    if (executed.kind === 'failed') {
      // A Run failure closes every not-yet-settled ToolCall of this batch with
      // a model-visible failed ToolResult before the Run ends.
      recordResult(closedToolResult(call, request.clock.now()));
      closeWith((remaining) => closedToolResult(remaining, request.clock.now()), index + 1);
      return { status: 'failed', failure: executed.failure, results: [...results] };
    }
    recordResult(executed.result);
  }

  const flushed = await flushParallelWindow();
  // Cancellation may win after the last call of the batch settled.
  if (flushed === 'cancelled' || request.signal.aborted) {
    return { status: 'cancelled', results: [...results] };
  }
  return { status: 'completed', results: [...results] };
}

type ToolCallOutcome =
  | { readonly kind: 'result'; readonly result: ToolResult }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly failure: ToolCallFailure };

async function executeToolCallWithPermissions(
  request: RunToolCallBatchRequest,
  call: CompletedToolCall,
  invocation: ToolInvocation,
  operations: readonly PermissionOperation[],
): Promise<ToolCallOutcome> {
  if (operations.length === 0) {
    return {
      kind: 'result',
      result: await executeToolInvocation(request, call, invocation, undefined),
    };
  }

  let permission;
  try {
    permission = await request.permissions.evaluateToolCall({
      runId: request.runId,
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      toolCallId: call.toolCallId,
      toolInput: snapshotValue(call.input) as import('@megumi/ai').JsonValue,
      operations,
      permissionMode: request.permissionMode,
      evaluatedAt: request.clock.now(),
    });
  } catch {
    return { kind: 'failed', failure: permissionFailure('Permission evaluation failed.') };
  }
  if (permission.status === 'failed') {
    return { kind: 'failed', failure: permissionFailure(permission.failure.message) };
  }
  if (permission.decision.type === 'deny') {
    const result: ToolResult = {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      callOrder: call.callOrder,
      status: 'permission_denied',
      error: { code: permission.decision.denialCode, message: permission.decision.reason },
      content: permission.decision.reason,
      completedAt: request.clock.now(),
    };
    request.events.publish('tool_execution.ended', {
      toolCallId: call.toolCallId,
      status: 'denied',
    });
    return { kind: 'result', result };
  }

  if (permission.decision.type === 'requires_approval') {
    if (request.signal.aborted) return { kind: 'cancelled' };
    // The Agent Loop owns the approval lifecycle: it applies the state
    // transitions, publishes the lifecycle facts and settles the wait.
    const resolution = await request.requestApproval({
      call,
      invocation,
      decision: permission.decision,
    });
    if (resolution.status === 'cancelled') {
      return { kind: 'cancelled' };
    }

    const applied = await applyApprovalDecision(
      request,
      call,
      operations,
      { decision: permission.decision, approvalSubject: permission.approvalSubject },
      resolution.decision,
    );
    if (applied.status === 'failed') {
      return { kind: 'failed', failure: permissionFailure('Approval decision could not be applied.') };
    }
    if (resolution.status === 'denied') {
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        callOrder: call.callOrder,
        status: 'user_rejected',
        error: { code: 'user_rejected', message: 'Tool call was rejected by the user.' },
        content: 'Tool call was rejected by the user.',
        completedAt: request.clock.now(),
      };
      request.events.publish('tool_execution.ended', {
        toolCallId: call.toolCallId,
        status: 'denied',
      });
      return { kind: 'result', result };
    }
    return {
      kind: 'result',
      result: await executeToolInvocation(request, call, invocation, applied.executionAccess),
    };
  }

  if (!permission.executionAccess) {
    return { kind: 'failed', failure: permissionFailure('Permission allow decision did not provide Tool execution access.') };
  }
  return {
    kind: 'result',
    result: await executeToolInvocation(request, call, invocation, permission.executionAccess),
  };
}

async function applyApprovalDecision(
  request: RunToolCallBatchRequest,
  call: CompletedToolCall,
  operations: readonly PermissionOperation[],
  original: {
    readonly decision: Extract<PermissionDecision, { type: 'requires_approval' }>;
    readonly approvalSubject: import('@megumi/permissions').ApprovalSubject;
  },
  decision: ApprovalDecision,
): Promise<{ readonly status: 'applied'; readonly executionAccess?: ToolExecutionAccess } | { readonly status: 'failed' }> {
  try {
    const current = await request.permissions.evaluateToolCall({
      runId: request.runId,
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      toolCallId: call.toolCallId,
      toolInput: snapshotValue(call.input) as import('@megumi/ai').JsonValue,
      operations,
      permissionMode: request.permissionMode,
      evaluatedAt: request.clock.now(),
    });
    if (current.status === 'failed') throw new Error(current.failure.message);
    const applied = await request.permissions.applyApprovalDecision({
      originalPermissionDecision: original.decision,
      originalSubject: original.approvalSubject,
      currentSubject: current.approvalSubject,
      decision,
      sessionId: request.sessionId,
      appliedAt: request.clock.now(),
      permissionMode: request.permissionMode,
    });
    if (applied.status !== 'applied') return { status: 'failed' };
    return { status: 'applied', ...(applied.executionAccess ? { executionAccess: applied.executionAccess } : {}) };
  } catch {
    return { status: 'failed' };
  }
}

async function executeToolInvocation(
  request: RunToolCallBatchRequest,
  call: CompletedToolCall,
  invocation: ToolInvocation,
  executionAccess: ToolExecutionAccess | undefined,
): Promise<ToolResult> {
  const toolExecutionId = request.ids.createToolExecutionId();
  const startedAt = request.clock.now();
  const span = request.observation.startSpan();

  request.events.publish('tool_execution.started', {
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
    const executionSignal = AbortSignal.any([request.signal, timeoutController.signal]);
    const timeout = setTimeout(() => timeoutController.abort(), request.policy.toolExecutionTimeoutMs);
    const cancelTimer = () => clearTimeout(timeout);
    try {
      result = await Promise.resolve(request.tools.executeToolInvocation({
        invocation,
        toolExecutionId,
      }, {
        signal: executionSignal,
        onOutput: (output) => {
          accumulatedOutput += output.chunk;
          request.events.publish('tool_execution.update', {
            toolCallId: call.toolCallId,
            output: accumulatedOutput,
          });
        },
        onNotification: (notification) => {
          planNotification = notification;
          request.events.publish('tool_execution.plan_updated', {
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

  const completedAt = request.clock.now();
  request.observation.endSpan(span, request.signal.aborted ? 'cancelled' : 'ok');

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
  if (request.signal.aborted && !executionResult) {
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
    emitToolExecutionEnded(request, toolResult, toolExecutionId, 'completed');
    return toolResult;
  }

  if (executionResult.error.code === 'tool_cancelled') {
    emitToolExecutionEnded(request, {
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

  emitToolExecutionEnded(request, {
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
  request: RunToolCallBatchRequest,
  result: ToolResult,
  toolExecutionId: string,
  status: 'completed' | 'failed' | 'cancelled',
): void {
  if (status === 'completed') {
    request.events.publish('tool_execution.ended', {
      toolCallId: result.toolCallId,
      toolExecutionId,
      status: 'completed',
      result: result.content,
      ...(result.summary ? { summary: result.summary } : {}),
    });
    return;
  }
  if (status === 'cancelled') {
    request.events.publish('tool_execution.ended', {
      toolCallId: result.toolCallId,
      toolExecutionId,
      status: 'cancelled',
    });
    return;
  }
  const error = result.error ?? { code: 'tool_execution_failed', message: 'Tool execution failed.' };
  request.events.publish('tool_execution.ended', {
    toolCallId: result.toolCallId,
    toolExecutionId,
    status: 'failed',
    error: { message: error.message, code: error.code },
  });
}

function permissionFailure(message: string): ToolCallFailure {
  return {
    code: 'permission_failed',
    message,
    owner: 'permissions',
    causeCode: 'permission_evaluation_failed',
  };
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
