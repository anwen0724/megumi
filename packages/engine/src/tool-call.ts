/*
 * Orchestrates ToolCall validation, permission barriers, execution windows, and final results.
 */
import type {
  ApprovalDecision,
  PermissionDecision,
  PermissionMode,
  PermissionOperation,
  Permissions,
  ApprovalSubject,
} from '@megumi/permissions';
import {
  type NormalizedToolResult,
  type RegisteredTool,
  type ToolExecutionObservation,
  type ToolExecutionResult,
  type ToolExecutor,
  type ToolIdentity,
  type ToolRuntimeSource,
  type JsonValue,
} from '@megumi/tools';
import type { EngineClock, EngineIdFactory, RunApproval } from './engine';
import type { EnginePolicy } from './engine-policy';
import type { RunFailure } from './run';
import type { ActiveRunStore, ClaimedRunApproval } from './active-run-store';

export interface ToolCall {
  readonly toolCallId: string;
  readonly modelCallId: string;
  readonly callOrder: number;
  readonly toolName: string;
  readonly input: unknown;
}

export type ToolExecutionStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export interface ToolExecution {
  readonly toolExecutionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly status: ToolExecutionStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface ToolResultError {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly callOrder: number;
  readonly status: 'success' | 'failure' | 'permission_denied' | 'user_rejected' | 'cancelled';
  readonly error?: ToolResultError;
  readonly content: string;
  readonly normalizedResult?: NormalizedToolResult;
  readonly observation?: ToolExecutionObservation;
  readonly runtimeSources?: readonly ToolRuntimeSource[];
  readonly completedAt: string;
}

export interface ToolCallApprovalContinuation {
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly permissionMode: PermissionMode;
  readonly toolCall: ToolCall;
  readonly registeredTool: RegisteredTool;
  readonly originalPermissionDecision: Extract<PermissionDecision, { type: 'requires_approval' }>;
  readonly originalApprovalSubject: ApprovalSubject;
  readonly completedToolResults: readonly ToolResult[];
  readonly completedToolExecutions: readonly ToolExecution[];
  readonly remainingToolCalls: readonly ToolCall[];
}

export interface ProcessToolCallsRequest {
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly permissionMode: PermissionMode;
  readonly toolCalls: readonly ToolCall[];
  readonly registeredTools: readonly RegisteredTool[];
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly toolExecution: Pick<ToolExecutor, 'preflight' | 'execute'>;
  readonly store: ActiveRunStore;
  readonly ids: Pick<EngineIdFactory, 'createToolExecutionId' | 'createRunApprovalId'>;
  readonly clock: EngineClock;
  readonly policy: Pick<
    EnginePolicy,
    'maxConcurrentToolExecutions' | 'toolExecutionTimeoutMs' | 'maxToolExecutionsPerCall'
  >;
  readonly signal: AbortSignal;
  readonly onToolExecutionStarted?: (execution: ToolExecution) => void;
  readonly onToolExecutionFinished?: (
    execution: ToolExecution,
    result: ToolResult,
  ) => void;
}

export type ProcessToolCallsResult =
  | {
      readonly status: 'completed';
      readonly toolResults: readonly ToolResult[];
      readonly toolExecutions: readonly ToolExecution[];
    }
  | {
      readonly status: 'waiting';
      readonly approval: RunApproval;
      readonly toolResults: readonly ToolResult[];
      readonly toolExecutions: readonly ToolExecution[];
      readonly remainingToolCalls: readonly ToolCall[];
    }
  | {
      readonly status: 'failed';
      readonly failure: RunFailure;
      readonly toolResults: readonly ToolResult[];
      readonly toolExecutions: readonly ToolExecution[];
    };

export interface ResumeToolCallApprovalRequest {
  readonly runApprovalId: string;
  readonly claimedApproval?: ClaimedRunApproval<ToolCallApprovalContinuation>;
  readonly decision: ApprovalDecision;
  readonly store: ActiveRunStore;
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly toolExecution: Pick<ToolExecutor, 'preflight' | 'execute'>;
  readonly ids: Pick<EngineIdFactory, 'createToolExecutionId' | 'createRunApprovalId'>;
  readonly clock: EngineClock;
  readonly policy: Pick<
    EnginePolicy,
    'maxConcurrentToolExecutions' | 'toolExecutionTimeoutMs' | 'maxToolExecutionsPerCall'
  >;
  readonly signal: AbortSignal;
  readonly onApprovalApplied?: (approval: RunApproval) => void;
  readonly onToolExecutionStarted?: (execution: ToolExecution) => void;
  readonly onToolExecutionFinished?: (
    execution: ToolExecution,
    result: ToolResult,
  ) => void;
}

export type ResumeToolCallApprovalResult =
  | {
      readonly status: 'resumed';
      readonly approval: RunApproval;
      readonly toolResults: readonly ToolResult[];
      readonly toolExecutions: readonly ToolExecution[];
      readonly remainingToolCalls: readonly ToolCall[];
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'already_claimed'; readonly approval: RunApproval }
  | { readonly status: 'already_resolved'; readonly approval: RunApproval }
  | { readonly status: 'failed'; readonly failure: RunFailure };

interface PlannedToolCall {
  readonly call: ToolCall;
  readonly registeredTool: RegisteredTool;
}

interface ExecutedToolCall {
  readonly toolResult: ToolResult;
  readonly toolExecution?: ToolExecution;
}

export async function processToolCalls(
  request: ProcessToolCallsRequest,
): Promise<ProcessToolCallsResult> {
  const calls = [...request.toolCalls]
    .map(snapshotToolCall)
    .sort((left, right) => left.callOrder - right.callOrder);
  const registeredTools = new Map(
    request.registeredTools.map((tool) => [tool.registeredToolName, tool]),
  );
  const toolResults: ToolResult[] = [];
  const toolExecutions: ToolExecution[] = [];
  let parallelWindow: PlannedToolCall[] = [];

  const flushParallelWindow = async () => {
    if (parallelWindow.length === 0) return;
    const completed = await executeParallelWindow(request, parallelWindow);
    for (const execution of completed) {
      toolResults.push(execution.toolResult);
      if (execution.toolExecution) toolExecutions.push(execution.toolExecution);
    }
    parallelWindow = [];
  };

  for (const [index, call] of calls.entries()) {
    if (request.signal.aborted) {
      await flushParallelWindow();
      for (const cancelledCall of calls.slice(index)) {
        toolResults.push(cancelledToolResult(cancelledCall, request.clock.now()));
      }
      return completedResult(toolResults, toolExecutions);
    }

    const registeredTool = registeredTools.get(call.toolName);
    if (!registeredTool) {
      await flushParallelWindow();
      toolResults.push(failedToolResult(
        call,
        'unknown_tool',
        'Unknown or unavailable tool.',
        request.clock.now(),
      ));
      continue;
    }

    const preflight = request.toolExecution.preflight({
      toolName: registeredTool.registeredToolName,
      input: call.input,
    });
    if (preflight.status === 'failed') {
      await flushParallelWindow();
      toolResults.push(failedToolResult(
        call,
        preflight.error.code,
        preflight.error.message,
        request.clock.now(),
      ));
      continue;
    }
    const preparedCall: ToolCall = {
      ...call,
      input: snapshotValue(preflight.input),
    };

    let permission;
    try {
      permission = await request.permissions.evaluateToolCall({
        runId: request.runId,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        toolCallId: call.toolCallId,
        toolInput: snapshotValue(preparedCall.input) as JsonValue,
        registeredTool,
        permissionMode: request.permissionMode,
        evaluatedAt: request.clock.now(),
      });
    } catch {
      await flushParallelWindow();
      return failedProcessing(
        permissionFailure('Permission evaluation failed.'),
        toolResults,
        toolExecutions,
      );
    }

    if (permission.status === 'failed') {
      await flushParallelWindow();
      return failedProcessing(
        permissionFailure(permission.failure.message),
        toolResults,
        toolExecutions,
      );
    }

    if (permission.decision.type === 'deny') {
      await flushParallelWindow();
      toolResults.push({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        callOrder: call.callOrder,
        status: 'permission_denied',
        error: {
          code: permission.decision.denialCode,
          message: permission.decision.reason,
        },
        content: permission.decision.reason,
        completedAt: request.clock.now(),
      });
      continue;
    }

    if (permission.decision.type === 'requires_approval') {
      await flushParallelWindow();
      if (request.signal.aborted) {
        for (const cancelledCall of calls.slice(index)) {
          toolResults.push(cancelledToolResult(cancelledCall, request.clock.now()));
        }
        return completedResult(toolResults, toolExecutions);
      }
      const approval = createRunApproval(request, preparedCall, registeredTool, permission.decision);
      const remainingToolCalls = calls.slice(index + 1);
      const continuation: ToolCallApprovalContinuation = {
        runId: request.runId,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        permissionMode: request.permissionMode,
        toolCall: preparedCall,
        registeredTool,
        originalPermissionDecision: permission.decision,
        originalApprovalSubject: permission.approvalSubject,
        completedToolResults: [...toolResults],
        completedToolExecutions: [...toolExecutions],
        remainingToolCalls,
      };
      const stored = request.store.putRunApproval({ approval, continuation });
      if (stored.status !== 'stored') {
        return failedProcessing(
          {
            code: 'runtime_protocol_violation',
            message: 'Run already has a pending approval.',
          },
          toolResults,
          toolExecutions,
        );
      }
      return {
        status: 'waiting',
        approval,
        toolResults: orderedResults(toolResults),
        toolExecutions,
        remainingToolCalls,
      };
    }

    const plan = { call: preparedCall, registeredTool };
    const executionMode = registeredTool.definition.executionMode ?? 'serial';
    if (executionMode === 'parallel') {
      parallelWindow.push(plan);
      continue;
    }

    await flushParallelWindow();
    const executed = await executeToolCall(request, plan);
    toolResults.push(executed.toolResult);
    if (executed.toolExecution) toolExecutions.push(executed.toolExecution);
  }

  await flushParallelWindow();
  return completedResult(toolResults, toolExecutions);
}

export async function resumeToolCallApproval(
  request: ResumeToolCallApprovalRequest,
): Promise<ResumeToolCallApprovalResult> {
  const claimedRecord = request.claimedApproval
    ?? claimApproval(request.store, request.runApprovalId);
  if ('status' in claimedRecord) return claimedRecord;
  const { approval, continuation } = claimedRecord;
  if (!approvalMatchesContinuation(approval, continuation, request.decision)) {
    cancelClaimedApproval(request.store, approval.runApprovalId, request.clock.now());
    return {
      status: 'failed',
      failure: permissionFailure('Approval no longer matches the pending ToolCall.'),
    };
  }

  let applied;
  try {
    const current = await request.permissions.evaluateToolCall({
      runId: approval.runId,
      sessionId: continuation.sessionId,
      workspaceId: continuation.workspaceId,
      toolCallId: continuation.toolCall.toolCallId,
      toolInput: snapshotValue(continuation.toolCall.input) as JsonValue,
      registeredTool: continuation.registeredTool,
      permissionMode: continuation.permissionMode,
      evaluatedAt: request.clock.now(),
    });
    if (current.status === 'failed') throw new Error(current.failure.message);
    applied = await request.permissions.applyApprovalDecision({
      originalPermissionDecision: continuation.originalPermissionDecision,
      originalSubject: continuation.originalApprovalSubject,
      currentSubject: current.approvalSubject,
      decision: request.decision,
      sessionId: continuation.sessionId,
      appliedAt: request.clock.now(),
    });
  } catch {
    cancelClaimedApproval(request.store, approval.runApprovalId, request.clock.now());
    return {
      status: 'failed',
      failure: permissionFailure('Approval decision could not be applied.'),
    };
  }

  if (applied.status !== 'applied') {
    cancelClaimedApproval(request.store, approval.runApprovalId, request.clock.now());
    return {
      status: 'failed',
      failure: permissionFailure('Approval decision could not be applied.'),
    };
  }

  const currentApproval = request.store.getRunApproval(approval.runApprovalId);
  if (
    !currentApproval
    || currentApproval.approval.status !== 'pending'
    || !currentApproval.claimed
  ) {
    return {
      status: 'failed',
      failure: permissionFailure('Approval is no longer pending for this Run.'),
    };
  }

  if (request.decision.decision === 'denied') {
    const resolvedApproval = request.store.resolveRunApproval({
      runApprovalId: approval.runApprovalId,
      status: 'denied',
      decidedAt: request.decision.decidedAt,
      decision: request.decision,
    });
    request.onApprovalApplied?.(resolvedApproval);
    return {
      status: 'resumed',
      approval: resolvedApproval,
      toolResults: orderedResults([
        ...continuation.completedToolResults,
        userRejectedToolResult(continuation.toolCall, request.clock.now()),
      ]),
      toolExecutions: continuation.completedToolExecutions,
      remainingToolCalls: continuation.remainingToolCalls,
    };
  }

  const resolvedApproval = request.store.resolveRunApproval({
    runApprovalId: approval.runApprovalId,
    status: 'approved',
    decidedAt: request.decision.decidedAt,
    decision: request.decision,
  });
  request.onApprovalApplied?.(resolvedApproval);
  let executed: ExecutedToolCall;
  try {
    executed = await executeToolCall(
      {
        runId: approval.runId,
        toolExecution: request.toolExecution,
        store: request.store,
        ids: request.ids,
        clock: request.clock,
        policy: request.policy,
        signal: request.signal,
        onToolExecutionStarted: request.onToolExecutionStarted,
        onToolExecutionFinished: request.onToolExecutionFinished,
      },
      {
        call: continuation.toolCall,
        registeredTool: continuation.registeredTool,
      },
    );
  } catch {
    return {
      status: 'failed',
      failure: {
        code: 'tool_system_failed',
        message: 'Approved ToolCall could not start execution.',
      },
    };
  }
  return {
    status: 'resumed',
    approval: resolvedApproval,
    toolResults: orderedResults([
      ...continuation.completedToolResults,
      executed.toolResult,
    ]),
    toolExecutions: [
      ...continuation.completedToolExecutions,
      ...(executed.toolExecution ? [executed.toolExecution] : []),
    ],
    remainingToolCalls: continuation.remainingToolCalls,
  };
}

function claimApproval(
  store: ActiveRunStore,
  runApprovalId: string,
):
  | ClaimedRunApproval<ToolCallApprovalContinuation>
  | Extract<ResumeToolCallApprovalResult, {
      status: 'not_found' | 'already_claimed' | 'already_resolved';
    }> {
  const claimed = store.claimRunApproval<ToolCallApprovalContinuation>(runApprovalId);
  if (claimed.status === 'claimed') return claimed.record;
  if (claimed.status === 'not_found') return { status: 'not_found' };
  return {
    status: claimed.status,
    approval: claimed.approval,
  };
}

async function executeParallelWindow(
  request: ProcessToolCallsRequest,
  window: readonly PlannedToolCall[],
): Promise<ExecutedToolCall[]> {
  const results: ExecutedToolCall[] = [];
  const concurrency = Math.max(1, request.policy.maxConcurrentToolExecutions);
  for (let index = 0; index < window.length; index += concurrency) {
    const batch = window.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map((plan) => executeToolCall(request, plan))));
  }
  return results;
}

async function executeToolCall(
  request: Pick<
    ProcessToolCallsRequest,
    | 'runId'
    | 'toolExecution'
    | 'store'
    | 'ids'
    | 'clock'
    | 'policy'
    | 'signal'
    | 'onToolExecutionStarted'
    | 'onToolExecutionFinished'
  >,
  plan: PlannedToolCall,
): Promise<ExecutedToolCall> {
  if (request.signal.aborted) {
    return {
      toolResult: cancelledToolResult(plan.call, request.clock.now()),
    };
  }

  // Tools currently expose no authoritative retry-safety guarantee. idempotentHint is insufficient,
  // so this V2 batch deliberately creates at most one real ToolExecution for each ToolCall.
  const toolExecutionId = request.ids.createToolExecutionId();
  const startedAt = request.clock.now();
  const runningExecution: ToolExecution = {
    toolExecutionId,
    runId: request.runId,
    toolCallId: plan.call.toolCallId,
    status: 'running',
    startedAt,
  };
  request.store.addActiveToolExecution({ runId: request.runId, toolExecutionId });
  request.onToolExecutionStarted?.(runningExecution);
  let interruption: ReturnType<typeof createToolInterruption> | undefined;

  try {
    const timeoutController = new AbortController();
    const signal = AbortSignal.any([request.signal, timeoutController.signal]);
    interruption = createToolInterruption({
      runSignal: request.signal,
      timeoutController,
      timeoutMs: request.policy.toolExecutionTimeoutMs,
    });
    const execution = Promise.resolve(request.toolExecution.execute({
      toolName: plan.registeredTool.registeredToolName,
      input: plan.call.input,
    }, { signal }))
      .then((result) => ({ type: 'result' as const, result }))
      .catch(() => ({ type: 'thrown' as const }));
    const outcome = await Promise.race([execution, interruption.result]);
    const completedAt = request.clock.now();

    if (outcome.type === 'interrupted') {
      const timedOut = outcome.reason === 'timeout';
      if (!timedOut) await execution;
      return finishExecution(request, {
        toolExecution: {
          ...runningExecution,
          status: timedOut ? 'timed_out' : 'cancelled',
          completedAt,
        },
        toolResult: timedOut
          ? failedToolResult(
              plan.call,
              'tool_execution_timeout',
              'Tool execution timed out.',
              completedAt,
            )
          : cancelledToolResult(plan.call, completedAt),
      });
    }
    if (outcome.type === 'thrown') {
      return finishExecution(request, {
        toolExecution: {
          ...runningExecution,
          status: 'failed',
          completedAt,
        },
        toolResult: failedToolResult(
          plan.call,
          'tool_execution_failed',
          'Tool execution failed.',
          completedAt,
        ),
      });
    }

    return finishExecution(
      request,
      mapExecutionResult(plan.call, runningExecution, outcome.result, completedAt),
    );
  } finally {
    interruption?.dispose();
    request.store.removeActiveToolExecution(toolExecutionId);
  }
}

function finishExecution(
  request: Pick<ProcessToolCallsRequest, 'onToolExecutionFinished'>,
  executed: ExecutedToolCall,
): ExecutedToolCall {
  if (executed.toolExecution) {
    request.onToolExecutionFinished?.(executed.toolExecution, executed.toolResult);
  }
  return executed;
}

function mapExecutionResult(
  call: ToolCall,
  execution: ToolExecution,
  result: ToolExecutionResult,
  completedAt: string,
): ExecutedToolCall {
  if (result.type === 'succeeded') {
    return {
      toolExecution: { ...execution, status: 'succeeded', completedAt },
      toolResult: {
        toolCallId: call.toolCallId,
        toolName: result.toolName,
        callOrder: call.callOrder,
        status: 'success',
        content: result.normalizedResult.content,
        normalizedResult: result.normalizedResult,
        ...(result.observation
          ? { observation: result.observation }
          : {}),
        ...(result.runtimeSources ? { runtimeSources: result.runtimeSources } : {}),
        completedAt,
      },
    };
  }

  if (result.error.code === 'tool_cancelled') {
    return {
      toolExecution: { ...execution, status: 'cancelled', completedAt },
      toolResult: {
        ...cancelledToolResult(call, completedAt),
        content: result.normalizedResult.content,
        normalizedResult: result.normalizedResult,
      },
    };
  }

  return {
    toolExecution: { ...execution, status: 'failed', completedAt },
    toolResult: {
      toolCallId: call.toolCallId,
      toolName: result.toolName ?? call.toolName,
      callOrder: call.callOrder,
      status: 'failure',
      error: result.error,
      content: result.normalizedResult.content,
      normalizedResult: result.normalizedResult,
      ...(result.observation
        ? { observation: result.observation }
        : {}),
      completedAt,
    },
  };
}

function createRunApproval(
  request: ProcessToolCallsRequest,
  call: ToolCall,
  registeredTool: RegisteredTool,
  decision: Extract<PermissionDecision, { type: 'requires_approval' }>,
): RunApproval {
  return {
    runApprovalId: request.ids.createRunApprovalId(),
    runId: request.runId,
    toolCallId: call.toolCallId,
    toolName: registeredTool.registeredToolName,
    toolIdentity: snapshotToolIdentity(registeredTool.identity),
    input: snapshotValue(call.input),
    operations: decision.operations.map((operation) => snapshotValue(operation) as PermissionOperation),
    options: decision.options,
    defaultOptionId: decision.defaultOptionId,
    summary: `${registeredTool.registeredToolName} requires approval.`,
    createdAt: request.clock.now(),
    status: 'pending',
  };
}

function approvalMatchesContinuation(
  approval: RunApproval,
  continuation: ToolCallApprovalContinuation,
  decision: ApprovalDecision,
): boolean {
  return decision.approvalRequestId === approval.runApprovalId
    && approval.runId === continuation.runId
    && approval.toolCallId === continuation.toolCall.toolCallId
    && sameToolIdentity(approval.toolIdentity, continuation.registeredTool.identity)
    && structurallyEqual(approval.input, continuation.toolCall.input)
    && structurallyEqual(
      approval.operations,
      continuation.originalPermissionDecision.operations,
    );
}

function permissionFailure(message: string): RunFailure {
  return {
    code: 'permission_failed',
    message,
  };
}

function cancelClaimedApproval(
  store: ActiveRunStore,
  runApprovalId: string,
  decidedAt: string,
): void {
  const current = store.getRunApproval(runApprovalId);
  if (current?.approval.status !== 'pending' || !current.claimed) return;
  store.resolveRunApproval({
    runApprovalId,
    status: 'cancelled',
    decidedAt,
  });
}

function failedProcessing(
  failure: RunFailure,
  toolResults: readonly ToolResult[],
  toolExecutions: readonly ToolExecution[],
): ProcessToolCallsResult {
  return {
    status: 'failed',
    failure,
    toolResults: orderedResults(toolResults),
    toolExecutions,
  };
}

function completedResult(
  toolResults: readonly ToolResult[],
  toolExecutions: readonly ToolExecution[],
): ProcessToolCallsResult {
  return {
    status: 'completed',
    toolResults: orderedResults(toolResults),
    toolExecutions,
  };
}

function failedToolResult(
  call: ToolCall,
  code: string,
  message: string,
  completedAt: string,
): ToolResult {
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    callOrder: call.callOrder,
    status: 'failure',
    error: { code, message },
    content: message,
    completedAt,
  };
}

function cancelledToolResult(call: ToolCall, completedAt: string): ToolResult {
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    callOrder: call.callOrder,
    status: 'cancelled',
    error: {
      code: 'tool_cancelled',
      message: 'Tool call was cancelled.',
    },
    content: 'Tool call was cancelled.',
    completedAt,
  };
}

function userRejectedToolResult(call: ToolCall, completedAt: string): ToolResult {
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    callOrder: call.callOrder,
    status: 'user_rejected',
    error: {
      code: 'user_rejected',
      message: 'Tool call was rejected by the user.',
    },
    content: 'Tool call was rejected by the user.',
    completedAt,
  };
}

function orderedResults(results: readonly ToolResult[]): ToolResult[] {
  return [...results].sort((left, right) => left.callOrder - right.callOrder);
}

function snapshotToolCall(call: ToolCall): ToolCall {
  return {
    ...call,
    input: snapshotValue(call.input),
  };
}

function snapshotToolIdentity(identity: ToolIdentity): ToolIdentity {
  return { ...identity };
}

function sameToolIdentity(left: ToolIdentity, right: ToolIdentity): boolean {
  return left.sourceId === right.sourceId
    && left.namespace === right.namespace
    && left.sourceToolName === right.sourceToolName;
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((item, index) => structurallyEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => (
        key === rightKeys[index] && structurallyEqual(left[key], right[key])
      ));
  }
  return false;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createToolInterruption(input: {
  readonly runSignal: AbortSignal;
  readonly timeoutController: AbortController;
  readonly timeoutMs: number;
}): {
  readonly result: Promise<{
    readonly type: 'interrupted';
    readonly reason: 'cancelled' | 'timeout';
  }>;
  readonly dispose: () => void;
} {
  let settled = false;
  let resolve!: (result: {
    readonly type: 'interrupted';
    readonly reason: 'cancelled' | 'timeout';
  }) => void;
  const result = new Promise<{
    readonly type: 'interrupted';
    readonly reason: 'cancelled' | 'timeout';
  }>((complete) => {
    resolve = complete;
  });
  const finish = (reason: 'cancelled' | 'timeout') => {
    if (settled) return;
    settled = true;
    resolve({ type: 'interrupted', reason });
  };
  const onAbort = () => finish('cancelled');
  input.runSignal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    finish('timeout');
    input.timeoutController.abort();
  }, input.timeoutMs);
  if (input.runSignal.aborted) finish('cancelled');

  return {
    result,
    dispose: () => {
      clearTimeout(timeout);
      input.runSignal.removeEventListener('abort', onAbort);
    },
  };
}
