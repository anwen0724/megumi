/*
 * Defines the stable Engine boundary and its owner-provided composition dependencies.
 */
import type { Api, Model, Models } from '@megumi/ai';
import type { UserInput } from '@megumi/input';
import type { ContextBuilder, ContextCompactor, ExecutionEnvironment } from '@megumi/context';
import type { InstructionReader } from '@megumi/instructions';
import type { Skills } from '@megumi/skills';
import type { EventBus } from '@megumi/events';
import type {
  ApprovalDecision,
  ApprovalOption,
  PermissionMode,
  PermissionOperation,
  Permissions,
} from '@megumi/permissions';
import type {
  SessionEntry,
  SessionMessageWithAttachments,
  SessionHistory,
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
import {
  continueRunAfterApproval,
  createEngineRunRuntime,
  emitRunStarted,
  launchRunLoop,
  requestRunCancellation,
  startRunObservability,
  type RunLoopDependencies,
} from './run-loop';
import type { ToolCallApprovalContinuation } from './tool-call';
import { canonicalJson } from './canonical-json';

export type RunInput = UserInput;

export interface EngineWorkspaceSource {
  resolve(request: { readonly workspaceId: string }):
    | {
        readonly status: 'resolved';
        readonly workspaceRoot: string;
        readonly executionEnvironment: ExecutionEnvironment;
      }
    | {
        readonly status: 'failed';
        readonly failure: { readonly code: string; readonly message: string };
      };
}

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

export interface ResumeRunRequest {
  readonly runApprovalId: string;
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

export type ResumeRunResult =
  | {
      readonly status: 'resumed';
      readonly run: Run;
    }
  | { readonly status: 'not_found'; readonly runApprovalId: string }
  | { readonly status: 'not_waiting'; readonly run: Run }
  | { readonly status: 'already_resolved'; readonly run: Run }
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
  resumeRun(request: ResumeRunRequest): Promise<ResumeRunResult>;
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
  readonly scopeResolver: EngineWorkspaceSource;
  readonly instructions: Pick<InstructionReader, 'getEffectiveInstructions'>;
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
  readonly skills: Pick<Skills, 'createView'>;
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
  const dependencies: RunLoopDependencies = {
    ...options,
    policy,
    store,
  };
  let accepting = true;
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

      const runtime = createEngineRunRuntime({
        run,
        userMessage: saved.message,
        userEntry: saved.entry,
        userInput: request.input,
      });
      store.setRunRuntime(run.runId, runtime);
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
      dependencies.events.publish({
        type: 'message.started',
        payload: { role: 'user', messageId: userMessageId },
        sessionId: request.sessionId,
      });
      dependencies.events.publish({
        type: 'message.ended',
        payload: { role: 'user', messageId: userMessageId, content: userMessageText(request.input) },
        sessionId: request.sessionId,
      });
      startRunObservability(dependencies, runtime, run);
      emitRunStarted(dependencies, runtime, run);
      queueMicrotask(() => launchRunLoop(dependencies, runtime));
      return {
        status: 'started',
        run,
        userMessage: saved.message,
        userEntry: saved.entry,
      };
    },

    async resumeRun(request): Promise<ResumeRunResult> {
      if (!accepting) {
        return {
          status: 'failed',
          failure: shuttingDownFailure('Engine is shutting down and is not accepting Run resumes.'),
        };
      }
      const record = store.getRunApproval(request.runApprovalId);
      if (!record) {
        return { status: 'not_found', runApprovalId: request.runApprovalId };
      }
      const run = store.getRun(record.approval.runId);
      if (!run) {
        return { status: 'not_found', runApprovalId: request.runApprovalId };
      }
      if (record.approval.status !== 'pending') {
        return { status: 'already_resolved', run };
      }
      if (run.status !== 'waiting') return { status: 'not_waiting', run };
      const runtime = store.getRunRuntime(run.runId);
      if (!runtime) {
        return {
          status: 'failed',
          failure: {
            code: 'runtime_protocol_violation',
            message: 'Waiting Run has no active runtime.',
            retryable: false,
            cause: { owner: 'engine', code: 'waiting_runtime_missing' },
          },
        };
      }
      const claimed = store.claimRunApproval<ToolCallApprovalContinuation>(
        request.runApprovalId,
      );
      if (claimed.status === 'not_found') {
        return { status: 'not_found', runApprovalId: request.runApprovalId };
      }
      if (claimed.status === 'already_claimed' || claimed.status === 'already_resolved') {
        return { status: 'already_resolved', run };
      }
      type ResumeEstablishment =
        | { readonly status: 'resumed'; readonly run: Run }
        | { readonly status: 'not_waiting'; readonly run: Run }
        | { readonly status: 'failed'; readonly failure: RunFailure };
      let settleEstablishment!: (result: ResumeEstablishment) => void;
      let establishmentSettled = false;
      const establishment = new Promise<ResumeEstablishment>((resolve) => {
        settleEstablishment = (result) => {
          if (establishmentSettled) return;
          establishmentSettled = true;
          resolve(result);
        };
      });
      const task = continueRunAfterApproval({
        dependencies,
        runtime,
        runApprovalId: request.runApprovalId,
        claimedApproval: claimed.record,
        onRunResumed: (resumedRun) => {
          settleEstablishment({ status: 'resumed', run: resumedRun });
        },
        decision: request.decision.decision === 'approved'
          ? {
              approvalRequestId: request.runApprovalId,
              decision: 'approved',
              optionId: request.decision.optionId,
              decidedBy: 'user',
              decidedAt: options.clock.now(),
              ...(request.decision.reason ? { reason: request.decision.reason } : {}),
            }
          : {
              approvalRequestId: request.runApprovalId,
              decision: 'denied',
              decidedBy: 'user',
              decidedAt: options.clock.now(),
              ...(request.decision.reason ? { reason: request.decision.reason } : {}),
            },
      });
      runtime.activeTask = task;
      void task.then((outcome) => {
        if (outcome.status === 'failed') {
          settleEstablishment({ status: 'failed', failure: outcome.failure });
          return;
        }
        const current = store.getRun(run.runId);
        if (current) {
          settleEstablishment({ status: 'not_waiting', run: current });
          return;
        }
        settleEstablishment({
          status: 'failed',
          failure: {
            code: 'runtime_protocol_violation',
            message: 'Run disappeared while applying its approval decision.',
            retryable: false,
            cause: { owner: 'engine', code: 'approval_run_missing' },
          },
        });
      }, () => {
        settleEstablishment({
          status: 'failed',
          failure: {
            code: 'internal_error',
            message: 'Run approval continuation failed unexpectedly.',
            retryable: false,
            cause: { owner: 'engine', code: 'approval_continuation_failed' },
          },
        });
      });
      void task.finally(() => {
        if (runtime.activeTask === task) runtime.activeTask = undefined;
      }).catch(() => undefined);
      const established = await establishment;
      if (established.status === 'failed') {
        return { status: 'failed', failure: established.failure };
      }
      if (established.status === 'not_waiting') {
        return { status: 'not_waiting', run: established.run };
      }
      return {
        status: 'resumed',
        run: established.run,
      };
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
      const runtime = store.getRunRuntime(run.runId);
      if (!runtime) {
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
        return {
          status: 'already_terminal',
          run: failed,
        };
      }
      const cancelling = transitionRun(run, {
        status: 'cancelling',
        at: options.clock.now(),
      });
      store.updateRun(cancelling);
      requestRunCancellation(dependencies, runtime, cancelling);
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

function userMessageText(input: RunInput): string {
  return input.displayContent
    .map((block) => block.type === 'text' ? block.text : '')
    .join('');
}

function shuttingDownFailure(message: string): RunFailure {
  return {
    code: 'internal_error',
    message,
    retryable: false,
    cause: { owner: 'engine', code: 'engine_shutting_down' },
  };
}
