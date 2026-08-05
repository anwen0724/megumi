/*
 * Defines the stable Engine boundary: Run creation, approval resolution,
 * cancellation, queries and shutdown over the single ActiveRunStore and one
 * runAgentLoop() call per Run. The Engine owns Run lifecycle settlement; the
 * Agent Loop owns the model/tool execution flow.
 */
import type { Api, Model, Models } from '@megumi/ai';
import type { UserInput } from '@megumi/input';
import type { ContextBuilder, ContextCompactor } from '@megumi/context';
import type { EventBus, EventPayloadByType, EventType } from '@megumi/events';
import type {
  ApprovalDecision,
  ApprovalOption,
  PermissionMode,
  PermissionOperation,
  Permissions,
} from '@megumi/permissions';
import type {
  SessionEntry,
  SessionHistory,
  SessionMessageWithAttachments,
} from '@megumi/session';
import type { ToolIdentity, Tools } from '@megumi/tools';
import type { ObservabilityService } from '@megumi/observability';
import type { EnginePolicy } from './engine-policy';
import { validateEnginePolicy } from './engine-policy';
import { ActiveRunStore } from './active-run-store';
import {
  createRun,
  isTerminalRunStatus,
  transitionRun,
  type Run,
  type RunFailure,
} from './run';
import { runAgentLoop, type AgentLoopDependencies, type AgentLoopResult } from './agent-loop';

export type RunInput = UserInput;

export interface StartRunRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly input: RunInput;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
}

export type StartRunResult =
  | {
      readonly status: 'started';
      readonly run: Run;
      readonly userMessage: SessionMessageWithAttachments;
      readonly userEntry: SessionEntry;
    }
  | {
      readonly status: 'already_started';
      readonly run: Run;
      readonly userMessage: SessionMessageWithAttachments;
      readonly userEntry: SessionEntry;
    }
  | {
      readonly status: 'session_busy';
      readonly activeRun: Run;
    }
  | {
      readonly status: 'failed';
      readonly failure: RunFailure;
    };

export interface ResolveApprovalRequest {
  readonly approvalId: string;
  readonly decision: RunApprovalDecision;
}

export type RunApprovalDecision =
  | {
      readonly decision: 'approved';
      readonly optionId: string;
      readonly reason?: string;
    }
  | {
      readonly decision: 'denied';
      readonly reason?: string;
    };

export type ResolveApprovalResult =
  | { readonly status: 'accepted'; readonly run: Run }
  | { readonly status: 'not_found'; readonly approvalId: string }
  | { readonly status: 'not_waiting'; readonly approvalId: string; readonly run: Run }
  | { readonly status: 'already_resolved'; readonly approvalId: string; readonly run: Run }
  | { readonly status: 'failed'; readonly failure: RunFailure };

export interface CancelRunRequest {
  readonly runId: string;
}

export type CancelRunResult =
  | {
      readonly status: 'cancellation_requested';
      readonly run: Run;
    }
  | { readonly status: 'already_cancelling'; readonly run: Run }
  | { readonly status: 'already_terminal'; readonly run: Run }
  | { readonly status: 'not_found'; readonly runId: string };

export interface GetRunRequest {
  readonly runId: string;
}

export type GetRunResult =
  | { readonly status: 'found'; readonly run: Run }
  | { readonly status: 'not_found'; readonly runId: string };

export interface ShutdownEngineRequest {
  readonly timeoutMs: number;
}

export type ShutdownEngineResult =
  | { readonly status: 'shut_down' }
  | { readonly status: 'timed_out'; readonly activeRuns: readonly Run[] };

export interface Engine {
  startRun(request: StartRunRequest): Promise<StartRunResult>;
  resolveApproval(request: ResolveApprovalRequest): Promise<ResolveApprovalResult>;
  cancelRun(request: CancelRunRequest): Promise<CancelRunResult>;
  getRun(request: GetRunRequest): GetRunResult;
  shutdown(request: ShutdownEngineRequest): Promise<ShutdownEngineResult>;
}

export type RunApprovalStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export interface RunApproval {
  readonly runApprovalId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolIdentity: ToolIdentity;
  readonly input: unknown;
  readonly operations: readonly PermissionOperation[];
  readonly options: readonly ApprovalOption[];
  readonly defaultOptionId: string;
  readonly summary?: string;
  readonly preview?: {
    readonly action: string;
    readonly targets: readonly {
      readonly kind: string;
      readonly label: string;
    }[];
  };
  readonly createdAt: string;
  readonly status: RunApprovalStatus;
  readonly decidedAt?: string;
  readonly decision?: ApprovalDecision;
}

export interface EngineIdFactory {
  createRunId(): string;
  createModelCallId(): string;
  createToolExecutionId(): string;
  createRunApprovalId(): string;
  createSessionMessageId(): string;
  createRuntimeEventId(): string;
}

export interface EngineClock {
  now(): string;
}

export interface CreateEngineOptions {
  readonly models: Models;
  readonly context: Pick<ContextBuilder, 'build'> & Pick<ContextCompactor, 'compact'>;
  readonly session: Pick<
    SessionHistory,
    'saveUserMessage' | 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'
  >;
  readonly tools: Pick<
    Tools,
    | 'resolveModelCallTools'
    | 'routeToolCall'
    | 'executeToolInvocation'
    | 'releaseModelCallTools'
  >;
  readonly permissions: Pick<
    Permissions,
    'evaluateToolCall' | 'applyApprovalDecision'
  >;
  readonly events: EventBus;
  readonly observability?: ObservabilityService;
  readonly ids: EngineIdFactory;
  readonly clock: EngineClock;
  readonly policy: EnginePolicy;
}

export function createEngine(options: CreateEngineOptions): Engine {
  const policy = validateEnginePolicy(options.policy);
  const store = new ActiveRunStore({
    clock: options.clock,
    terminalRunRetentionMs: policy.terminalRunRetentionMs,
  });
  const dependencies: AgentLoopDependencies = {
    ...options,
    policy,
  };
  let accepting = true;

  const settleLoopResult = (runId: string, result: AgentLoopResult): void => {
    const active = store.getActiveRun(runId);
    if (!active || isTerminalRunStatus(active.run.status)) return;
    const at = options.clock.now();
    // Cancellation may win the settle race: a cancelling Run always converges
    // as cancelled, never as completed or failed.
    if (active.run.status === 'cancelling') {
      const cancelled = transitionRun(active.run, { status: 'cancelled', at });
      store.updateRun(cancelled);
      publish(cancelled, 'run.ended', { status: 'cancelled' });
      return;
    }
    if (result.status === 'completed') {
      const completed = transitionRun(active.run, { status: 'completed', at });
      store.updateRun(completed);
      publish(completed, 'run.ended', {
        status: 'completed',
        assistantMessageId: result.assistantMessageId,
      });
      return;
    }
    if (result.status === 'failed') {
      const failed = transitionRun(active.run, { status: 'failed', at, failure: result.failure });
      store.updateRun(failed);
      publish(failed, 'run.ended', {
        status: 'failed',
        error: {
          message: result.failure.message,
          code: result.failure.code,
          retryable: result.failure.retryable,
          ...(result.failure.cause ? { cause: { ...result.failure.cause } } : {}),
        },
      });
      return;
    }
    // Cancelled: the Run is already cancelling (cancelRun/shutdown own the
    // running|waiting -> cancelling transition).
    const cancelled = transitionRun(active.run, { status: 'cancelled', at });
    store.updateRun(cancelled);
    publish(cancelled, 'run.ended', { status: 'cancelled' });
  };

  const publish = <TType extends EventType>(
    run: Run,
    type: TType,
    payload: EventPayloadByType[TType],
    omitRunId = false,
  ): void => {
    options.events.publish({
      type,
      payload,
      sessionId: run.sessionId,
      ...(omitRunId ? {} : { runId: run.runId }),
    });
  };

  const engine: Engine = {
    async startRun(request): Promise<StartRunResult> {
      if (!accepting) {
        return {
          status: 'failed',
          failure: shuttingDownFailure('Engine is shutting down and is not accepting new Runs.'),
        };
      }
      const createdAt = options.clock.now();
      const runId = options.ids.createRunId();
      const userMessageId = options.ids.createSessionMessageId();
      const run = createRun({
        runId,
        requestId: request.requestId,
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
        ...(request.parentEntryId ? { parentEntryId: request.parentEntryId } : {}),
        userMessageId,
        model: request.model,
        permissionMode: request.permissionMode,
        createdAt,
      });
      const reserved = store.reserveStart({
        requestId: request.requestId,
        fingerprint: {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...(request.parentEntryId ? { parentEntryId: request.parentEntryId } : {}),
          inputDigest: canonicalJson(request.input),
        },
        run,
      });
      if (reserved.status === 'pending') {
        const completion = await reserved.completion;
        return completion.status === 'started'
          ? {
              status: 'already_started',
              run: completion.result.run,
              userMessage: completion.result.userMessage,
              userEntry: completion.result.userEntry,
            }
          : { status: 'failed', failure: completion.failure };
      }
      if (reserved.status === 'already_started') {
        return {
          status: 'already_started',
          run: reserved.result.run,
          userMessage: reserved.result.userMessage,
          userEntry: reserved.result.userEntry,
        };
      }
      if (reserved.status === 'request_conflict') {
        return {
          status: 'failed',
          failure: {
            code: 'runtime_protocol_violation',
            message: 'requestId was reused with different Run input.',
            retryable: false,
            cause: { owner: 'engine', code: 'request_id_conflict' },
          },
        };
      }
      if (reserved.status === 'session_busy') {
        return { status: 'session_busy', activeRun: reserved.activeRun };
      }

      const saved = await options.session.saveUserMessage({
        message_id: userMessageId,
        session_id: request.sessionId,
        run_id: runId,
        display_content: [...request.input.displayContent],
        model_content: [...request.input.modelContent],
        ...(request.input.skillSelection ? {
          skill_selection: {
            name: request.input.skillSelection.name,
            skill_path: request.input.skillSelection.skillPath,
          },
        } : {}),
        attachments: request.input.attachments.map((attachment) => (
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
        ...(request.parentEntryId ? { parent_entry_id: request.parentEntryId } : {}),
        created_at: createdAt,
      });
      if (saved.status === 'failed') {
        const failure: RunFailure = {
          code: 'session_failed',
          message: saved.failure.message,
          retryable: false,
          cause: { owner: 'session', code: saved.failure.code },
        };
        store.failStart({ requestId: request.requestId, failure });
        return { status: 'failed', failure };
      }

      const abortController = new AbortController();
      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      const activeRun = {
        run,
        abortController,
        completion,
        pendingApproval: undefined,
      };
      store.attachActiveRun(activeRun);
      store.completeStart({
        requestId: request.requestId,
        result: {
          run,
          userMessage: saved.message,
          userEntry: saved.entry,
        },
      });

      // The user message is the run's input: it precedes run.started and
      // carries no runId (ordering contract, see events/CONTEXT.md).
      publish(run, 'message.started', {
        role: 'user',
        messageId: userMessageId,
      }, true);
      publish(run, 'message.ended', {
        role: 'user',
        messageId: userMessageId,
        content: userMessageText(request.input),
      }, true);
      publish(run, 'run.started', {
        requestId: run.requestId,
        providerId: String(run.model.provider),
        modelId: run.model.id,
      });

      const loopTask = runAgentLoop({
        run,
        userInput: request.input,
        userEntry: saved.entry,
        signal: abortController.signal,
        transitionRunStatus: (status) => {
          const current = store.getActiveRun(runId);
          if (!current || isTerminalRunStatus(current.run.status)) return;
          if (current.run.status === 'waiting' && status === 'running') {
            store.updateRun(transitionRun(current.run, { status: 'running', at: options.clock.now() }));
          } else if (current.run.status === 'running' && status === 'waiting') {
            store.updateRun(transitionRun(current.run, { status: 'waiting', at: options.clock.now() }));
          }
        },
        awaitApproval: (request) => store.beginApprovalWait({
          runId,
          approval: request.approval,
        }),
      }, dependencies);
      void loopTask.then((result) => {
        settleLoopResult(runId, result);
        resolveCompletion();
      }, () => {
        const current = store.getActiveRun(runId);
        if (!current || isTerminalRunStatus(current.run.status)) {
          resolveCompletion();
          return;
        }
        settleLoopResult(runId, {
          status: 'failed',
          failure: {
            code: 'internal_error',
            message: 'Run execution failed unexpectedly.',
            retryable: false,
            cause: { owner: 'engine', code: 'unexpected_exception' },
          },
        });
        resolveCompletion();
      });

      return {
        status: 'started',
        run,
        userMessage: saved.message,
        userEntry: saved.entry,
      };
    },

    async resolveApproval(request): Promise<ResolveApprovalResult> {
      const resolved = store.resolveApproval({
        approvalId: request.approvalId,
        decision: toApprovalDecision(request.decision, request.approvalId, options.clock.now()),
      });
      if (resolved.status === 'accepted') return { status: 'accepted', run: resolved.run };
      if (resolved.status === 'not_found') return { status: 'not_found', approvalId: request.approvalId };
      if (resolved.status === 'not_waiting') {
        return { status: 'not_waiting', approvalId: request.approvalId, run: resolved.run };
      }
      return { status: 'already_resolved', approvalId: request.approvalId, run: resolved.run };
    },

    async cancelRun(request): Promise<CancelRunResult> {
      const run = store.getRun(request.runId);
      if (!run) return { status: 'not_found', runId: request.runId };
      if (isTerminalRunStatus(run.status)) {
        return { status: 'already_terminal', run };
      }
      if (run.status === 'cancelling') {
        return { status: 'already_cancelling', run };
      }
      const active = store.getActiveRun(request.runId);
      if (!active) {
        const failed = transitionRun(run, {
          status: 'failed',
          at: options.clock.now(),
          failure: {
            code: 'cancellation_failed',
            message: 'Run runtime is unavailable.',
            retryable: false,
            cause: { owner: 'engine', code: 'run_runtime_missing' },
          },
        });
        store.updateRun(failed);
        return { status: 'already_terminal', run: failed };
      }
      const cancelling = transitionRun(run, {
        status: 'cancelling',
        at: options.clock.now(),
      });
      store.updateRun(cancelling);
      publish(cancelling, 'run.cancel.requested', {
        requestedBy: 'user',
        reason: 'user_cancelled',
        scope: 'run',
      });
      // A pending approval wait must settle as cancelled so the Agent Loop
      // wakes and converges in place.
      store.cancelPendingApproval(run.runId);
      active.abortController.abort();
      return {
        status: 'cancellation_requested',
        run: cancelling,
      };
    },

    getRun(request): GetRunResult {
      const run = store.getRun(request.runId);
      return run
        ? { status: 'found', run }
        : { status: 'not_found', runId: request.runId };
    },

    async shutdown(request): Promise<ShutdownEngineResult> {
      accepting = false;
      await Promise.allSettled(
        store.listActiveRuns().map((run) => engine.cancelRun({ runId: run.runId })),
      );
      const idle = await store.waitForIdle(request.timeoutMs);
      return idle
        ? { status: 'shut_down' }
        : { status: 'timed_out', activeRuns: store.listActiveRuns() };
    },
  };
  return engine;
}

function toApprovalDecision(
  decision: RunApprovalDecision,
  approvalId: string,
  decidedAt: string,
): ApprovalDecision {
  return decision.decision === 'approved'
    ? {
        approvalRequestId: approvalId,
        decision: 'approved',
        optionId: decision.optionId,
        decidedBy: 'user',
        decidedAt,
        ...(decision.reason ? { reason: decision.reason } : {}),
      }
    : {
        approvalRequestId: approvalId,
        decision: 'denied',
        decidedBy: 'user',
        decidedAt,
        ...(decision.reason ? { reason: decision.reason } : {}),
      };
}

function userMessageText(input: RunInput): string {
  return input.displayContent
    .map((block) => block.type === 'text' ? block.text : '')
    .join('');
}

/** Stable canonical serialization for request-id idempotency fingerprints. */
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

function shuttingDownFailure(message: string): RunFailure {
  return {
    code: 'internal_error',
    message,
    retryable: false,
    cause: { owner: 'engine', code: 'engine_shutting_down' },
  };
}
