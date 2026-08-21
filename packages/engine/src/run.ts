/*
 * Defines the public Run snapshot, the single RunStatus lifecycle transition
 * invariant, and the Runs operation entry: start idempotency, per-Session
 * exclusion, the User Message commit, the root AbortController, the unique
 * executeAgentRun() launch, approval settlement, cancel/get/shutdown, the single
 * terminal settlement from EngineAgentRunResult and the run.* lifecycle events.
 * Agent execution details never live here.
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
import type { RunPolicy } from './run-policy';
import { validateRunPolicy } from './run-policy';
import { RunRegistry } from './run-registry';
import {
  executeAgentRun,
  type EngineAgentRunDependencies,
  type EngineAgentRunResult,
} from './agent-adapter';

// ---------------------------------------------------------------------------
// Run model
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RunFailureCode =
  | 'session_failed'
  | 'context_failed'
  | 'model_call_failed'
  | 'permission_failed'
  | 'tool_system_failed'
  | 'loop_limit_exceeded'
  | 'runtime_protocol_violation'
  | 'cancellation_failed'
  | 'internal_error';

export interface RunFailure {
  readonly code: RunFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: RunFailureCause;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RunFailureCause {
  readonly owner: 'ai' | 'context' | 'permissions' | 'tools' | 'session' | 'skills' | 'workspace' | 'instructions' | 'engine';
  readonly code: string;
}

export interface Run {
  readonly executionId: string;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly userMessageId: string;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly failure?: RunFailure;
}

export interface CreateRunInput {
  readonly executionId: string;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly userMessageId: string;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
  readonly createdAt: string;
}

export type RunTransition =
  | {
      readonly status: Exclude<RunStatus, 'failed'>;
      readonly at: string;
      readonly failure?: never;
    }
  | {
      readonly status: 'failed';
      readonly at: string;
      readonly failure: RunFailure;
    };

const ALLOWED_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  running: ['waiting', 'cancelling', 'completed', 'failed'],
  waiting: ['running', 'cancelling', 'failed'],
  cancelling: ['cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export class RunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunTransitionError';
  }
}

export function createRun(input: CreateRunInput): Run {
  return {
    ...input,
    status: 'running',
    startedAt: input.createdAt,
  };
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function transitionRun(run: Run, transition: RunTransition): Run {
  if (!ALLOWED_TRANSITIONS[run.status].includes(transition.status)) {
    throw new RunTransitionError(
      `Invalid Run transition from ${run.status} to ${transition.status}.`,
    );
  }

  if (transition.status === 'failed' && transition.failure === undefined) {
    throw new RunTransitionError('Run failure is required when entering failed.');
  }

  if (transition.status !== 'failed' && transition.failure !== undefined) {
    throw new RunTransitionError('Run failure is only valid when entering failed.');
  }

  const terminal = isTerminalRunStatus(transition.status);
  return {
    ...run,
    status: transition.status,
    ...(terminal ? { completedAt: transition.at } : {}),
    ...(transition.status === 'failed' ? { failure: transition.failure } : {}),
  };
}

// ---------------------------------------------------------------------------
// Run operations contract
// ---------------------------------------------------------------------------

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
  readonly executionId: string;
}

export type CancelRunResult =
  | {
      readonly status: 'cancellation_requested';
      readonly run: Run;
    }
  | { readonly status: 'already_cancelling'; readonly run: Run }
  | { readonly status: 'already_terminal'; readonly run: Run }
  | { readonly status: 'not_found'; readonly executionId: string };

export interface GetRunRequest {
  readonly executionId: string;
}

export type GetRunResult =
  | { readonly status: 'found'; readonly run: Run }
  | { readonly status: 'not_found'; readonly executionId: string };

export interface GetActiveRunRequest {
  readonly sessionId: string;
}

export type GetActiveRunResult =
  | { readonly status: 'found'; readonly run: Run }
  | { readonly status: 'not_found'; readonly sessionId: string };

export interface ShutdownRunsRequest {
  readonly timeoutMs: number;
}

export type ShutdownRunsResult =
  | { readonly status: 'shut_down' }
  | { readonly status: 'timed_out'; readonly activeRuns: readonly Run[] };

export interface Runs {
  start(request: StartRunRequest): Promise<StartRunResult>;
  resolveApproval(request: ResolveApprovalRequest): Promise<ResolveApprovalResult>;
  cancel(request: CancelRunRequest): Promise<CancelRunResult>;
  get(request: GetRunRequest): GetRunResult;
  /** Reads the one current Run for a Session from Engine-owned registry state. */
  getActive(request: GetActiveRunRequest): GetActiveRunResult;
  shutdown(request: ShutdownRunsRequest): Promise<ShutdownRunsResult>;
}

export type RunApprovalStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export interface RunApproval {
  readonly runApprovalId: string;
  readonly executionId: string;
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

export interface RunClock {
  now(): string;
}

export interface CreateRunsOptions {
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
  /** The ID creation capabilities the Run execution base needs; never exported as an object. */
  readonly ids: {
    createExecutionId(): string;
    createModelCallId(): string;
    createToolExecutionId(): string;
    createRunApprovalId(): string;
    createSessionMessageId(): string;
  };
  readonly clock: RunClock;
  readonly policy: RunPolicy;
}

export function createRuns(options: CreateRunsOptions): Runs {
  const policy = validateRunPolicy(options.policy);
  const store = new RunRegistry({
    clock: options.clock,
    terminalRunRetentionMs: policy.terminalRunRetentionMs,
  });
  const dependencies: EngineAgentRunDependencies = {
    ...options,
    policy,
  };
  let accepting = true;

  const settleAgentResult = (executionId: string, result: EngineAgentRunResult): void => {
    const active = store.getActiveRun(executionId);
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
    // Cancelled: the Run is already cancelling (cancel/shutdown own the
    // running|waiting -> cancelling transition).
    const cancelled = transitionRun(active.run, { status: 'cancelled', at });
    store.updateRun(cancelled);
    publish(cancelled, 'run.ended', { status: 'cancelled' });
  };

  const publish = <TType extends EventType>(
    run: Run,
    type: TType,
    payload: EventPayloadByType[TType],
    omitExecutionId = false,
  ): void => {
    options.events.publish({
      type,
      payload,
      sessionId: run.sessionId,
      ...(omitExecutionId ? {} : { executionId: run.executionId }),
    });
  };

  const runs: Runs = {
    async start(request): Promise<StartRunResult> {
      if (!accepting) {
        return {
          status: 'failed',
          failure: shuttingDownFailure('Engine is shutting down and is not accepting new Runs.'),
        };
      }
      const createdAt = options.clock.now();
      const executionId = options.ids.createExecutionId();
      const userMessageId = options.ids.createSessionMessageId();
      const run = createRun({
        executionId,
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
        execution_id: executionId,
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
      // carries no executionId (ordering contract, see events/CONTEXT.md).
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

      const agentTask = executeAgentRun({
        run,
        userInput: request.input,
        userEntry: saved.entry,
        signal: abortController.signal,
        transitionRunStatus: (status) => {
          const current = store.getActiveRun(executionId);
          if (!current || isTerminalRunStatus(current.run.status)) return;
          if (current.run.status === 'waiting' && status === 'running') {
            store.updateRun(transitionRun(current.run, { status: 'running', at: options.clock.now() }));
          } else if (current.run.status === 'running' && status === 'waiting') {
            store.updateRun(transitionRun(current.run, { status: 'waiting', at: options.clock.now() }));
          }
        },
        awaitApproval: (request) => store.beginApprovalWait({
          executionId,
          approval: request.approval,
        }),
      }, dependencies);
      // The unique Agent execution settles the ActiveRun completion on every path:
      // normal return, unexpected throw, or a settlement step that fails again.
      // Each settlement attempt is guarded so a second failure never forms an
      // unhandled rejection and never overwrites already recorded terminal
      // facts; the finally guarantees resolveCompletion runs exactly once.
      const settleSafely = (settle: () => void): void => {
        try {
          settle();
        } catch (error) {
          recordSettlementFailure(options, error);
        }
      };
      void agentTask.then(
        (result) => {
          settleSafely(() => settleAgentResult(executionId, result));
        },
        () => {
          settleSafely(() => {
            const current = store.getActiveRun(executionId);
            if (!current || isTerminalRunStatus(current.run.status)) return;
            settleAgentResult(executionId, {
              status: 'failed',
              failure: {
                code: 'internal_error',
                message: 'Run execution failed unexpectedly.',
                retryable: false,
                cause: { owner: 'engine', code: 'unexpected_exception' },
              },
            });
          });
        },
      ).finally(() => {
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

    async cancel(request): Promise<CancelRunResult> {
      const run = store.getRun(request.executionId);
      if (!run) return { status: 'not_found', executionId: request.executionId };
      if (isTerminalRunStatus(run.status)) {
        return { status: 'already_terminal', run };
      }
      if (run.status === 'cancelling') {
        return { status: 'already_cancelling', run };
      }
      const active = store.getActiveRun(request.executionId);
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
      // A pending approval wait must settle as cancelled so the Agent execution
      // wakes and converges in place.
      store.cancelPendingApproval(run.executionId);
      active.abortController.abort();
      return {
        status: 'cancellation_requested',
        run: cancelling,
      };
    },

    get(request): GetRunResult {
      const run = store.getRun(request.executionId);
      return run
        ? { status: 'found', run }
        : { status: 'not_found', executionId: request.executionId };
    },

    getActive(request): GetActiveRunResult {
      const run = store.getActive(request.sessionId);
      return run
        ? { status: 'found', run }
        : { status: 'not_found', sessionId: request.sessionId };
    },

    async shutdown(request): Promise<ShutdownRunsResult> {
      accepting = false;
      await Promise.allSettled(
        store.listActiveRuns().map((run) => runs.cancel({ executionId: run.executionId })),
      );
      const idle = await store.waitForIdle(request.timeoutMs);
      return idle
        ? { status: 'shut_down' }
        : { status: 'timed_out', activeRuns: store.listActiveRuns() };
    },
  };
  return runs;
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

/** Records a terminal-settlement failure as a diagnostic; never changes Run outcome. */
function recordSettlementFailure(options: CreateRunsOptions, error: unknown): void {
  try {
    options.observability?.recordLog({
      level: 'error',
      event: 'run.settlement_failed',
      attributes: { errorMessage: error instanceof Error ? error.message : String(error) },
    });
  } catch {
    // Diagnostics never change Run outcome.
  }
}
