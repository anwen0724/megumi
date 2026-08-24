/* Owns admission, identity, registry state, approvals, cancellation, and settlement for Agent executions. */
import type { Agent } from '@megumi/agent-core';
import type { Api, Model } from '@megumi/ai';
import type {
  DailyDiscoveryContextMaterial,
  DailyDiscoveryRunContext,
} from '@megumi/context';
import type { EventBus, EventPayloadByType, EventType } from '@megumi/events';
import type { UserInput } from '@megumi/input';
import type { ApprovalDecision, PermissionMode } from '@megumi/permissions';
import type {
  RecommendationReferenceContent,
  SessionEntry,
  SessionMessageWithAttachments,
} from '@megumi/session';
import {
  ExecutionRegistry,
  ApprovalRequest,
  ApprovalResolution,
  type ExecutionClock,
  type ExecutionFailure,
  ExecutionMetadata,
  ExecutionOutcome,
  type ConversationExecutionMetadata,
  type DailyDiscoveryExecutionMetadata,
  type ExecutionSnapshot,
} from './execution-registry';

export interface LaunchConversationAgentExecutionInput {
  readonly kind: 'conversation';
  readonly metadata: ConversationExecutionMetadata;
  readonly input: UserInput;
  readonly recommendationReference?: RecommendationReferenceContent;
  readonly awaitApproval: (request: {
    readonly approval: ApprovalRequest;
  }) => Promise<ApprovalResolution>;
}

export interface LaunchDailyDiscoveryAgentExecutionInput {
  readonly kind: 'daily_discovery';
  readonly metadata: DailyDiscoveryExecutionMetadata;
  readonly runContext: DailyDiscoveryRunContext;
}

export type LaunchAgentExecutionInput =
  | LaunchConversationAgentExecutionInput
  | LaunchDailyDiscoveryAgentExecutionInput;

export interface LaunchedAgentExecution {
  readonly agent: Agent;
  readonly userMessage?: SessionMessageWithAttachments;
  readonly userEntry?: SessionEntry;
  readonly execute: () => Promise<ExecutionOutcome>;
}

export type LaunchAgentExecution = (
  input: LaunchAgentExecutionInput,
) => Promise<LaunchedAgentExecution>;

export interface ConversationExecutionInput {
  readonly kind: 'conversation';
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly input: UserInput;
  readonly recommendationReference?: RecommendationReferenceContent;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
}

export interface DailyDiscoveryExecutionInput<TRejected = unknown> {
  readonly kind: 'daily_discovery';
  readonly requestId: string;
  readonly batchId: string;
  readonly localDate: string;
  readonly material: DailyDiscoveryContextMaterial;
  readonly model: Model<Api>;
  accept(request: { readonly executionId: string }): Promise<
    | { readonly status: 'accepted' }
    | { readonly status: 'rejected'; readonly reason: TRejected }
  >;
  onSettled(request: {
    readonly executionId: string;
    readonly outcome: ExecutionOutcome;
  }): void | Promise<void>;
}

export type StartExecutionRequest = ConversationExecutionInput | DailyDiscoveryExecutionInput;

export type StartExecutionResult =
  | { readonly status: 'started'; readonly execution: ConversationExecutionSnapshot; readonly completion: Promise<ExecutionOutcome>; readonly userMessage: SessionMessageWithAttachments; readonly userEntry: SessionEntry }
  | { readonly status: 'already_started'; readonly execution: ConversationExecutionSnapshot; readonly completion: Promise<ExecutionOutcome>; readonly userMessage: SessionMessageWithAttachments; readonly userEntry: SessionEntry }
  | { readonly status: 'session_busy'; readonly activeExecution: ConversationExecutionSnapshot }
  | { readonly status: 'failed'; readonly failure: ExecutionFailure };

export type StartDailyDiscoveryExecutionResult<TRejected = unknown> =
  | { readonly status: 'started'; readonly execution: ExecutionSnapshot; readonly completion: Promise<ExecutionOutcome> }
  | { readonly status: 'already_started'; readonly execution: ExecutionSnapshot; readonly completion: Promise<ExecutionOutcome> }
  | { readonly status: 'rejected'; readonly reason: TRejected }
  | { readonly status: 'failed'; readonly failure: ExecutionFailure };

export interface ResolveApprovalRequest {
  readonly approvalId: string;
  readonly decision: ApprovalDecisionRequest;
}

export type ApprovalDecisionRequest =
  | { readonly decision: 'approved'; readonly optionId: string; readonly reason?: string }
  | { readonly decision: 'denied'; readonly reason?: string };

export type ResolveApprovalResult =
  | { readonly status: 'accepted'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found'; readonly approvalId: string }
  | { readonly status: 'not_waiting'; readonly approvalId: string; readonly execution: ExecutionSnapshot }
  | { readonly status: 'already_resolved'; readonly approvalId: string; readonly execution: ExecutionSnapshot }
  | { readonly status: 'failed'; readonly failure: ExecutionFailure };

export interface CancelExecutionRequest { readonly executionId: string }
export type CancelExecutionResult =
  | { readonly status: 'cancellation_requested'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'already_cancelling'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'already_terminal'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found'; readonly executionId: string };

export interface GetExecutionRequest { readonly executionId: string }
export type GetExecutionResult =
  | { readonly status: 'found'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found'; readonly executionId: string };

export interface GetActiveExecutionRequest { readonly sessionId: string }
export type GetActiveExecutionResult =
  | { readonly status: 'found'; readonly execution: ConversationExecutionSnapshot }
  | { readonly status: 'not_found'; readonly sessionId: string };

export interface ShutdownRequest { readonly timeoutMs: number }
export type ShutdownResult =
  | { readonly status: 'shut_down' }
  | { readonly status: 'timed_out'; readonly activeExecutions: readonly ExecutionSnapshot[] };

export type ConversationExecutionSnapshot = Extract<ExecutionSnapshot, { kind: 'conversation' }>;

export interface AgentExecutions {
  start(request: ConversationExecutionInput): Promise<StartExecutionResult>;
  start<TRejected>(request: DailyDiscoveryExecutionInput<TRejected>): Promise<StartDailyDiscoveryExecutionResult<TRejected>>;
  resolveApproval(request: ResolveApprovalRequest): Promise<ResolveApprovalResult>;
  cancel(request: CancelExecutionRequest): Promise<CancelExecutionResult>;
  get(request: GetExecutionRequest): GetExecutionResult;
  getActive(request: GetActiveExecutionRequest): GetActiveExecutionResult;
  shutdown(request: ShutdownRequest): Promise<ShutdownResult>;
}

export interface CreateAgentExecutionsOptions {
  readonly ids: { createExecutionId(): string; createSessionMessageId(): string };
  readonly clock: ExecutionClock;
  readonly terminalRetentionMs: number;
  readonly events: EventBus;
  readonly launch: LaunchAgentExecution;
  readonly onSettled?: (execution: ExecutionSnapshot, outcome: ExecutionOutcome) => void | Promise<void>;
}

export function createAgentExecutions(options: CreateAgentExecutionsOptions): AgentExecutions {
  const store = new ExecutionRegistry({ clock: options.clock, terminalRetentionMs: options.terminalRetentionMs });
  const dailySettlementHandlers = new Map<string, DailyDiscoveryExecutionInput['onSettled']>();
  let accepting = true;

  const publish = <TType extends EventType>(
    execution: ExecutionSnapshot,
    type: TType,
    payload: EventPayloadByType[TType],
    omitExecutionId = false,
  ): void => {
    if (execution.kind !== 'conversation') return;
    options.events.publish({
      type,
      payload,
      sessionId: execution.sessionId,
      ...(omitExecutionId ? {} : { executionId: execution.executionId }),
    });
  };

  const publishEnded = (execution: ExecutionSnapshot, outcome: ExecutionOutcome): void => {
    if (execution.kind !== 'conversation') return;
    if (outcome.status === 'completed') {
      if (!outcome.assistantMessageId) return;
      publish(execution, 'run.ended', { status: 'completed', assistantMessageId: outcome.assistantMessageId });
      return;
    }
    if (outcome.status === 'failed') {
      publish(execution, 'run.ended', {
        status: 'failed',
        error: {
          message: outcome.failure.message,
          code: outcome.failure.code,
          retryable: outcome.failure.retryable,
          ...(outcome.failure.cause ? { cause: { ...outcome.failure.cause } } : {}),
        },
      });
      return;
    }
    publish(execution, 'run.ended', { status: 'cancelled' });
  };

  const settleCompletion = (executionId: string, outcome: ExecutionOutcome): void => {
    try {
      store.settleTerminal(executionId, outcome);
      const terminal = store.getExecution(executionId);
      if (!terminal) return;
      publishEnded(terminal, outcome);
      void Promise.resolve(options.onSettled?.(terminal, outcome)).catch(() => undefined);
      const dailySettled = dailySettlementHandlers.get(executionId);
      dailySettlementHandlers.delete(executionId);
      if (dailySettled) {
        void Promise.resolve(dailySettled({ executionId, outcome })).catch(() => undefined);
      }
    } catch {
      // Settlement diagnostics must not alter the Agent Core outcome.
    }
  };

  const requestCancellation = async (executionId: string): Promise<CancelExecutionResult> => {
    const current = store.getExecution(executionId);
    if (!current) return { status: 'not_found', executionId };
    if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
      return { status: 'already_terminal', execution: current };
    }
    if (current.status === 'cancelling') return { status: 'already_cancelling', execution: current };
    store.cancelPendingApproval(executionId);
    store.getActiveExecutionHandle(executionId)?.agent.abort();
    if (current.kind === 'conversation') {
      publish(current, 'run.cancel.requested', {
        requestedBy: 'user',
        reason: 'user_cancelled',
        scope: 'run',
      });
    }
    return { status: 'cancellation_requested', execution: store.getExecution(executionId) ?? current };
  };

  const startExecution = async (
    request: ConversationExecutionInput | DailyDiscoveryExecutionInput,
  ): Promise<StartExecutionResult | StartDailyDiscoveryExecutionResult> => {
    if (!accepting) {
      return { status: 'failed', failure: executionFailure('Agent execution service is shutting down.', 'execution_shutting_down') };
    }
    return request.kind === 'conversation'
      ? startConversationExecution(request)
      : startDailyDiscoveryExecution(request);
  };

  async function startConversationExecution(request: ConversationExecutionInput): Promise<StartExecutionResult> {
    const createdAt = options.clock.now();
    const executionId = options.ids.createExecutionId();
    const userMessageId = options.ids.createSessionMessageId();
    const metadata: ConversationExecutionMetadata = {
      kind: 'conversation',
      executionId,
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      ...(request.parentEntryId ? { parentEntryId: request.parentEntryId } : {}),
      userMessageId,
      model: request.model,
      permissionMode: request.permissionMode,
      createdAt,
      startedAt: createdAt,
    };
    const reserved = store.reserveStart({
      requestId: request.requestId,
      fingerprint: {
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
        ...(request.parentEntryId ? { parentEntryId: request.parentEntryId } : {}),
        inputDigest: canonicalJson({ input: request.input, ...(request.recommendationReference ? { recommendationReference: request.recommendationReference } : {}) }),
      },
      metadata,
    });

    if (reserved.status === 'pending') {
      const established = await reserved.completion;
      if (established.status === 'failed') return { status: 'failed', failure: established.failure };
      return {
        status: 'already_started',
        ...established.result,
        completion: requireCompletion(store, established.result.execution.executionId),
      };
    }
    if (reserved.status === 'already_started') {
      return {
        status: 'already_started',
        ...reserved.result,
        completion: requireCompletion(store, reserved.result.execution.executionId),
      };
    }
    if (reserved.status === 'request_conflict') {
      return { status: 'failed', failure: executionFailure('requestId was reused with different execution input.', 'request_id_conflict') };
    }
    if (reserved.status === 'session_busy') return { status: 'session_busy', activeExecution: reserved.activeExecution };

    let launched: LaunchedAgentExecution;
    try {
      launched = await options.launch({
        kind: 'conversation',
        metadata,
        input: request.input,
        ...(request.recommendationReference ? { recommendationReference: request.recommendationReference } : {}),
        awaitApproval: ({ approval }) => store.beginApprovalWait({ executionId, approval }),
      });
    } catch (error) {
      const failure = launchFailure(error);
      store.failStart({ requestId: request.requestId, failure });
      return { status: 'failed', failure };
    }
    if (!launched.userMessage || !launched.userEntry) {
      const failure = executionFailure('Conversation launch did not commit its user message.', 'conversation_acceptance_missing');
      store.failStart({ requestId: request.requestId, failure });
      return { status: 'failed', failure };
    }

    const completion = attachExecution(metadata, launched);
    store.completeStart({
      requestId: request.requestId,
      executionId,
      userMessage: launched.userMessage,
      userEntry: launched.userEntry,
    });
    const execution = store.getExecution(executionId)!;
    if (execution.kind !== 'conversation') {
      throw new Error('Conversation start produced a non-conversation execution.');
    }
    publish(execution, 'message.started', { role: 'user', messageId: userMessageId }, true);
    publish(execution, 'message.ended', { role: 'user', messageId: userMessageId, content: userMessageText(request.input) }, true);
    publish(execution, 'run.started', {
      requestId: execution.requestId,
      providerId: String(execution.model.provider),
      modelId: execution.model.id,
    });
    return { status: 'started', execution, completion, userMessage: launched.userMessage, userEntry: launched.userEntry };
  }

  async function startDailyDiscoveryExecution(
    request: DailyDiscoveryExecutionInput,
  ): Promise<StartDailyDiscoveryExecutionResult> {
    const createdAt = options.clock.now();
    const executionId = options.ids.createExecutionId();
    const metadata: DailyDiscoveryExecutionMetadata = {
      kind: 'daily_discovery',
      executionId,
      requestId: request.requestId,
      batchId: request.batchId,
      localDate: request.localDate,
      model: request.model,
      createdAt,
      startedAt: createdAt,
    };
    const accepted = await request.accept({ executionId });
    if (accepted.status === 'rejected') return { status: 'rejected', reason: accepted.reason };

    let launched: LaunchedAgentExecution;
    try {
      launched = await options.launch({
        kind: 'daily_discovery',
        metadata,
        runContext: {
          kind: 'daily_discovery', executionId, batchId: request.batchId,
          localDate: request.localDate, material: request.material, model: request.model,
        },
      });
    } catch (error) {
      const failure = launchFailure(error);
      await request.onSettled({ executionId, outcome: { status: 'failed', failure } });
      return { status: 'failed', failure };
    }
    dailySettlementHandlers.set(executionId, request.onSettled);
    const completion = attachExecution(metadata, launched);
    const execution = store.getExecution(executionId)!;
    return { status: 'started', execution, completion };
  }

  function attachExecution(metadata: ExecutionMetadata, launched: LaunchedAgentExecution): Promise<ExecutionOutcome> {
    let resolveCompletion!: (outcome: ExecutionOutcome) => void;
    const completion = new Promise<ExecutionOutcome>((resolve) => { resolveCompletion = resolve; });
    store.attachActiveExecution({ metadata, agent: launched.agent, completion, pendingApproval: undefined });
    void completion.then((outcome) => settleCompletion(metadata.executionId, outcome));
    void launched.execute().then(
      resolveCompletion,
      () => resolveCompletion({ status: 'failed', failure: executionFailure('Execution failed unexpectedly.', 'unexpected_exception') }),
    );
    return completion;
  }

  return {
    start: startExecution as AgentExecutions['start'],

    async resolveApproval(request): Promise<ResolveApprovalResult> {
      const resolved = store.resolveApproval({
        approvalId: request.approvalId,
        decision: toApprovalDecision(request.decision, request.approvalId, options.clock.now()),
      });
      if (resolved.status === 'accepted') return { status: 'accepted', execution: resolved.execution };
      if (resolved.status === 'not_found') return { status: 'not_found', approvalId: request.approvalId };
      if (resolved.status === 'not_waiting') return { status: 'not_waiting', approvalId: request.approvalId, execution: resolved.execution };
      return { status: 'already_resolved', approvalId: request.approvalId, execution: resolved.execution };
    },

    cancel: ({ executionId }) => requestCancellation(executionId),
    get: ({ executionId }) => {
      const execution = store.getExecution(executionId);
      return execution ? { status: 'found', execution } : { status: 'not_found', executionId };
    },
    getActive: ({ sessionId }) => {
      const execution = store.getActive(sessionId);
      return execution?.kind === 'conversation'
        ? { status: 'found', execution }
        : { status: 'not_found', sessionId };
    },
    async shutdown({ timeoutMs }): Promise<ShutdownResult> {
      accepting = false;
      await Promise.allSettled(store.listActiveExecutions().map(({ executionId }) => requestCancellation(executionId)));
      const idle = await store.waitForIdle(timeoutMs);
      return idle ? { status: 'shut_down' } : { status: 'timed_out', activeExecutions: store.listActiveExecutions() };
    },
  };
}

function toApprovalDecision(decision: ApprovalDecisionRequest, approvalId: string, decidedAt: string): ApprovalDecision {
  return decision.decision === 'approved'
    ? { approvalRequestId: approvalId, decision: 'approved', optionId: decision.optionId, decidedBy: 'user', decidedAt, ...(decision.reason ? { reason: decision.reason } : {}) }
    : { approvalRequestId: approvalId, decision: 'denied', decidedBy: 'user', decidedAt, ...(decision.reason ? { reason: decision.reason } : {}) };
}

function userMessageText(input: UserInput): string {
  return input.displayContent.map((block) => block.type === 'text' ? block.text : '').join('');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireCompletion(store: ExecutionRegistry, executionId: string): Promise<ExecutionOutcome> {
  const completion = store.getCompletion(executionId);
  if (!completion) throw new Error(`Execution completion is unavailable: ${executionId}`);
  return completion;
}

function launchFailure(error: unknown): ExecutionFailure {
  if (typeof error === 'object' && error !== null && 'failure' in error) {
    return (error as { readonly failure: ExecutionFailure }).failure;
  }
  return executionFailure(error instanceof Error ? error.message : 'Execution launch failed.', 'launch_failed');
}

function executionFailure(message: string, code: string): ExecutionFailure {
  return {
    code: code === 'request_id_conflict' ? 'runtime_protocol_violation' : 'internal_error',
    message,
    retryable: false,
    cause: { owner: 'agent', code },
  };
}
