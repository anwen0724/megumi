/* Owns admission, identity, registry state, approvals, cancellation, and settlement for Agent executions. */
import type { Agent } from '@megumi/agent-core';
import type { Api, Model } from '@megumi/ai';
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
  type ExecutionSnapshot,
} from './execution-registry';

export interface LaunchAgentExecutionInput {
  readonly metadata: ExecutionMetadata;
  readonly input: UserInput;
  readonly recommendationReference?: RecommendationReferenceContent;
  readonly awaitApproval: (request: {
    readonly approval: ApprovalRequest;
  }) => Promise<ApprovalResolution>;
}

export interface LaunchedAgentExecution {
  readonly agent: Agent;
  readonly userMessage: SessionMessageWithAttachments;
  readonly userEntry: SessionEntry;
  readonly execute: () => Promise<ExecutionOutcome>;
}

export type LaunchAgentExecution = (
  input: LaunchAgentExecutionInput,
) => Promise<LaunchedAgentExecution>;

export interface StartExecutionRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly input: UserInput;
  readonly recommendationReference?: RecommendationReferenceContent;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
}

export type StartExecutionResult =
  | { readonly status: 'started'; readonly execution: ExecutionSnapshot; readonly userMessage: SessionMessageWithAttachments; readonly userEntry: SessionEntry }
  | { readonly status: 'already_started'; readonly execution: ExecutionSnapshot; readonly userMessage: SessionMessageWithAttachments; readonly userEntry: SessionEntry }
  | { readonly status: 'session_busy'; readonly activeExecution: ExecutionSnapshot }
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
  | { readonly status: 'found'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found'; readonly sessionId: string };

export interface ShutdownRequest { readonly timeoutMs: number }
export type ShutdownResult =
  | { readonly status: 'shut_down' }
  | { readonly status: 'timed_out'; readonly activeExecutions: readonly ExecutionSnapshot[] };

export interface AgentExecutions {
  start(request: StartExecutionRequest): Promise<StartExecutionResult>;
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
  let accepting = true;

  const publish = <TType extends EventType>(
    execution: ExecutionSnapshot,
    type: TType,
    payload: EventPayloadByType[TType],
    omitExecutionId = false,
  ): void => {
    options.events.publish({
      type,
      payload,
      sessionId: execution.sessionId,
      ...(omitExecutionId ? {} : { executionId: execution.executionId }),
    });
  };

  const publishEnded = (execution: ExecutionSnapshot, outcome: ExecutionOutcome): void => {
    if (outcome.status === 'completed') {
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
    publish(current, 'run.cancel.requested', {
      requestedBy: 'user',
      reason: 'user_cancelled',
      scope: 'run',
    });
    return { status: 'cancellation_requested', execution: store.getExecution(executionId) ?? current };
  };

  return {
    async start(request): Promise<StartExecutionResult> {
      if (!accepting) {
        return { status: 'failed', failure: executionFailure('Agent execution service is shutting down.', 'execution_shutting_down') };
      }
      const createdAt = options.clock.now();
      const executionId = options.ids.createExecutionId();
      const userMessageId = options.ids.createSessionMessageId();
      const metadata: ExecutionMetadata = {
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
        const completion = await reserved.completion;
        return completion.status === 'started'
          ? { status: 'already_started', execution: completion.result.execution, userMessage: completion.result.userMessage, userEntry: completion.result.userEntry }
          : { status: 'failed', failure: completion.failure };
      }
      if (reserved.status === 'already_started') {
        return { status: 'already_started', execution: reserved.result.execution, userMessage: reserved.result.userMessage, userEntry: reserved.result.userEntry };
      }
      if (reserved.status === 'request_conflict') {
        return { status: 'failed', failure: executionFailure('requestId was reused with different execution input.', 'request_id_conflict') };
      }
      if (reserved.status === 'session_busy') return { status: 'session_busy', activeExecution: reserved.activeExecution };

      let launched: LaunchedAgentExecution;
      try {
        launched = await options.launch({
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

      let resolveCompletion!: (outcome: ExecutionOutcome) => void;
      const completion = new Promise<ExecutionOutcome>((resolve) => { resolveCompletion = resolve; });
      store.attachActiveExecution({ metadata, agent: launched.agent, completion, pendingApproval: undefined });
      void completion.then((outcome) => settleCompletion(executionId, outcome));
      store.completeStart({
        requestId: request.requestId,
        executionId,
        userMessage: launched.userMessage,
        userEntry: launched.userEntry,
      });

      const execution = store.getExecution(executionId)!;
      publish(execution, 'message.started', { role: 'user', messageId: userMessageId }, true);
      publish(execution, 'message.ended', { role: 'user', messageId: userMessageId, content: userMessageText(request.input) }, true);
      publish(execution, 'run.started', {
        requestId: execution.requestId,
        providerId: String(execution.model.provider),
        modelId: execution.model.id,
      });
      void launched.execute().then(
        resolveCompletion,
        () => resolveCompletion({ status: 'failed', failure: executionFailure('Execution failed unexpectedly.', 'unexpected_exception') }),
      );
      return { status: 'started', execution, userMessage: launched.userMessage, userEntry: launched.userEntry };
    },

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
      return execution ? { status: 'found', execution } : { status: 'not_found', sessionId };
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
