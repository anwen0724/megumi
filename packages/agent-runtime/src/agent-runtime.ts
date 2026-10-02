/* Owns the shared run entrypoint, input preparation and shutdown of one AgentRuntime. */
import {
  prepareModel,
  readModelCatalog,
  type ModelResolutionOptions,
  type ModelSelection,
  type ModelPreparationResult,
  type ModelCatalogResult,
} from './runs/model-resolution';
import {
  createRunManager,
  type ConversationExecutionInput,
  type CreateRunManagerOptions,
  type ResolveApprovalRequest,
} from './runs/run-manager';
import { prepareRun, type RunDependencies } from './runs/execute-run';
import {
  createConversationSubmission,
  type ConversationSubmissionDependencies,
  type SubmitConversationInputRequest,
  type SubmitConversationInputResult,
} from './runs/submit-input';
import type { ExecutionFailure, ExecutionOutcome, ExecutionSnapshot } from './runs/run-registry';
export type { ApprovalDecisionRequest } from './runs/run-manager';

export type RunFailureCode =
  | 'SESSION_FAILED'
  | 'CONTEXT_FAILED'
  | 'MODEL_CALL_FAILED'
  | 'PERMISSION_FAILED'
  | 'TOOL_SYSTEM_FAILED'
  | 'LOOP_LIMIT_EXCEEDED'
  | 'RUNTIME_PROTOCOL_VIOLATION'
  | 'CANCELLATION_FAILED'
  | 'INTERNAL_ERROR';

export interface RunError {
  readonly code: RunFailureCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type AgentRunOutcome =
  | { readonly status: 'completed'; readonly assistantMessageId?: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly error: RunError };

export interface AgentRunSnapshot {
  readonly runId: string;
  readonly requestId: string;
  readonly kind: 'conversation' | 'recommendation' | 'candidate_supply';
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly status: ExecutionSnapshot['status'];
  readonly createdAt: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly error?: RunError;
}

export interface AgentRunHandle {
  readonly runId: string;
  readonly snapshot: AgentRunSnapshot;
  /** Resolves once after execution, required recording and cleanup. */
  readonly completion: Promise<AgentRunOutcome>;
}

export type StartRunRequest = (
  | (Omit<ConversationExecutionInput, 'model' | 'client' | 'compactionThresholdRatio'> & {
      modelSelection?: ModelSelection;
    })
  | {
      readonly kind: 'recommendation';
      readonly runId: string;
      readonly requestId: string;
      readonly localDate: string;
      readonly modelSelection?: ModelSelection;
    }
  | {
      readonly kind: 'candidate_supply';
      readonly runId: string;
      readonly requestId: string;
      readonly trigger: string;
      readonly modelSelection?: ModelSelection;
    }
) & { readonly signal?: AbortSignal };

export type StartRunResult =
  | { readonly status: 'started' | 'already_started'; readonly run: AgentRunHandle }
  | {
      readonly status: 'rejected';
      readonly error: {
        readonly code:
          | RunFailureCode
          | 'RUN_CONFLICT'
          | 'RUNTIME_STOPPED'
          | 'RUN_CANCELLED'
          | 'MODEL_UNAVAILABLE';
        readonly message: string;
      };
    };

export type CancelRunResult =
  | {
      readonly status: 'cancellation_requested' | 'already_cancelling' | 'already_terminal';
      readonly run: AgentRunSnapshot;
    }
  | { readonly status: 'not_found'; readonly runId: string };

export type RuntimeApprovalResult =
  | {
      readonly status: 'accepted' | 'not_waiting' | 'already_resolved';
      readonly run: AgentRunSnapshot;
    }
  | { readonly status: 'not_found'; readonly approvalId: string }
  | { readonly status: 'failed'; readonly error: RunError };

export type InputFailureCode =
  'INPUT_REJECTED' | 'MODEL_UNAVAILABLE' | 'RUN_CONFLICT' | 'RUNTIME_STOPPED';

export type SubmitInputResult =
  | {
      readonly status: 'started';
      readonly requestId: string;
      readonly session: Extract<
        SubmitConversationInputResult,
        { status: 'agent_started' }
      >['session'];
      readonly userMessage: Extract<
        SubmitConversationInputResult,
        { status: 'agent_started' }
      >['userMessage'];
      readonly branchCommit?: Extract<
        SubmitConversationInputResult,
        { status: 'agent_started' }
      >['branchCommit'];
      readonly run: AgentRunHandle;
    }
  | Extract<SubmitConversationInputResult, { status: 'completed' | 'host_interaction_requested' }>
  | {
      readonly status: 'rejected';
      readonly requestId: string;
      readonly session?: Extract<SubmitConversationInputResult, { status: 'failed' }>['session'];
      readonly error: { readonly code: InputFailureCode; readonly message: string };
    };

export interface AgentRuntime {
  /** Reads the current model catalog through the bound configuration access. */
  readModelCatalog(request?: { workspaceId?: string }): ModelCatalogResult;
  /** Prepares a model and client for a run or a single AI completion. */
  prepareModel(request?: {
    workspaceId?: string;
    selection?: ModelSelection;
  }): Promise<ModelPreparationResult>;
  /** Starts a prepared task; the handle separately represents its final completion. */
  startRun(request: StartRunRequest): Promise<StartRunResult>;
  /** Returns an isolated snapshot, or undefined when no retained run exists. */
  getRun(runId: string): AgentRunSnapshot | undefined;
  /** Returns the run occupying a session, including admission and cleanup. */
  getSessionRun(sessionId: string): AgentRunSnapshot | undefined;
  /** Requests cancellation; callers await the handle to observe actual termination. */
  cancelRun(runId: string): Promise<CancelRunResult>;
  /** Resolves an outstanding approval without restarting the tool call. */
  resolveApproval(request: ResolveApprovalRequest): Promise<RuntimeApprovalResult>;
  /** Prepares user input, including pure commands, before admitting a conversation run. */
  submitInput(request: SubmitConversationInputRequest): Promise<SubmitInputResult>;
  /** Stops admission, requests cancellation and waits up to timeoutMs for active runs. */
  stop(request: {
    readonly timeoutMs: number;
  }): Promise<
    | { readonly status: 'stopped' }
    | { readonly status: 'timed_out'; readonly runs: readonly AgentRunSnapshot[] }
  >;
}

export interface CreateAgentRuntimeOptions {
  readonly execution: RunDependencies;
  readonly input: Omit<ConversationSubmissionDependencies, 'resolveModel'>;
  readonly modelResolution: (workspaceId?: string) => ModelResolutionOptions;
  readonly createRunId: () => string;
  readonly terminalRetentionMs: number;
  /** Commits application-owned execution records before completion and session release. */
  readonly finalizeRun?: (
    run: Pick<AgentRunSnapshot, 'runId' | 'kind' | 'sessionId' | 'workspaceId'>,
  ) => void | Promise<void>;
  /** Receives the completed fact; business work must observe its own completion. */
  readonly onSettled?: CreateRunManagerOptions['onSettled'];
}

/** Connects input, sessions, context, tools and the single run manager for all task sources. */
export function createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime {
  const runs = createRunManager({
    ids: {
      createExecutionId: options.createRunId,
      createSessionMessageId: options.execution.ids.createSessionMessageId,
    },
    clock: options.execution.clock,
    terminalRetentionMs: options.terminalRetentionMs,
    events: options.execution.events,
    launch: (request) => prepareRun(request, options.execution),
    onSettled: options.onSettled,
    beforeComplete: (metadata) =>
      options.finalizeRun?.({
        runId: metadata.executionId,
        kind: metadata.kind,
        ...(metadata.kind === 'conversation'
          ? { sessionId: metadata.sessionId, workspaceId: metadata.workspaceId }
          : {}),
      }),
  });
  const resolveModel = (workspaceId?: string, selection?: ModelSelection) =>
    prepareModel(options.modelResolution(workspaceId), selection);
  const input = createConversationSubmission({
    dependencies: { ...options.input, resolveModel },
    startExecution: runs.start,
  });
  let accepting = true;
  return {
    readModelCatalog: (request) =>
      readModelCatalog(options.modelResolution(request?.workspaceId).settings),
    prepareModel: (request) => resolveModel(request?.workspaceId, request?.selection),
    async startRun(request) {
      if (!accepting)
        return {
          status: 'rejected',
          error: { code: 'RUNTIME_STOPPED', message: 'The runtime has stopped accepting runs.' },
        };
      if (
        request.kind !== 'conversation' &&
        runs.get({ executionId: request.runId }).status === 'found'
      ) {
        return {
          status: 'rejected',
          error: { code: 'RUN_CONFLICT', message: 'A run with this identity already exists.' },
        };
      }
      const session =
        request.kind === 'conversation'
          ? options.input.sessions.getSession({ session_id: request.sessionId })
          : undefined;
      if (session?.status === 'failed') {
        return {
          status: 'rejected',
          error: { code: 'SESSION_FAILED', message: session.failure.message },
        };
      }
      const selection =
        request.modelSelection ??
        (session?.status === 'found' ? session.session.model_selection : undefined);
      const prepared = await resolveModel(
        request.kind === 'conversation' ? request.workspaceId : undefined,
        selection,
      );
      if (request.signal?.aborted)
        return {
          status: 'rejected',
          error: { code: 'RUN_CANCELLED', message: 'Run was cancelled before admission.' },
        };
      if (prepared.status === 'failed')
        return {
          status: 'rejected',
          error: { code: 'MODEL_UNAVAILABLE', message: prepared.failure.message },
        };
      const result = await runs.start({
        ...request,
        model: prepared.model,
        client: prepared.client,
        compactionThresholdRatio: prepared.compactionThresholdRatio,
      });
      if (result.status === 'started' || result.status === 'already_started') {
        return {
          status: result.status,
          run: {
            runId: result.execution.executionId,
            snapshot: toRunSnapshot(result.execution),
            completion: result.completion.then(toRunOutcome),
          },
        };
      }
      if (result.status === 'session_busy') {
        return {
          status: 'rejected',
          error: { code: 'RUN_CONFLICT', message: 'The session already has an active run.' },
        };
      }
      return {
        status: 'rejected',
        error:
          result.status === 'failed'
            ? toRunError(result.failure)
            : { code: 'INTERNAL_ERROR', message: 'Run admission failed.' },
      };
    },
    getRun(runId) {
      const result = runs.get({ executionId: runId });
      return result.status === 'found' ? toRunSnapshot(result.execution) : undefined;
    },
    getSessionRun(sessionId) {
      const result = runs.getActive({ sessionId });
      return result.status === 'found' ? toRunSnapshot(result.execution) : undefined;
    },
    async cancelRun(runId) {
      const result = await runs.cancel({ executionId: runId });
      return result.status === 'not_found'
        ? { status: 'not_found', runId }
        : { status: result.status, run: toRunSnapshot(result.execution) };
    },
    async resolveApproval(request) {
      const result = await runs.resolveApproval(request);
      if (result.status === 'failed')
        return { status: 'failed', error: toRunError(result.failure) };
      if (result.status === 'not_found') return result;
      return { status: result.status, run: toRunSnapshot(result.execution) };
    },
    async submitInput(request) {
      if (!accepting)
        return {
          status: 'rejected',
          requestId: request.requestId ?? crypto.randomUUID(),
          error: { code: 'RUNTIME_STOPPED', message: 'The runtime has stopped accepting input.' },
        };
      const occupying = request.sessionId
        ? runs.getActive({ sessionId: request.sessionId })
        : undefined;
      if (occupying?.status === 'found' && occupying.execution.requestId !== request.requestId)
        return {
          status: 'rejected',
          requestId: request.requestId ?? crypto.randomUUID(),
          error: { code: 'RUN_CONFLICT', message: 'The session already has an active run.' },
        };
      const result = await input.submit(request);
      if (result.status === 'failed')
        return {
          status: 'rejected',
          requestId: result.requestId,
          ...(result.session ? { session: result.session } : {}),
          error: { code: inputFailureCode(result.failure.code), message: result.failure.message },
        };
      if (result.status !== 'agent_started') return result;
      const completion = runs.wait(result.execution.executionId);
      if (!completion) throw new Error('An accepted run must have a retained completion.');
      return {
        status: 'started',
        requestId: result.requestId,
        session: result.session,
        userMessage: result.userMessage,
        ...(result.branchCommit ? { branchCommit: result.branchCommit } : {}),
        run: {
          runId: result.execution.executionId,
          snapshot: toRunSnapshot(result.execution),
          completion: completion.then(toRunOutcome),
        },
      };
    },
    async stop(request) {
      accepting = false;
      // The deadline covers both admitted runs and input preparation already in flight.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const [result, inputStopped] = await Promise.all([
          runs.shutdown(request),
          Promise.race([
            input.shutdown().then(() => true),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), Math.max(0, request.timeoutMs));
            }),
          ]),
        ]);
        if (result.status === 'timed_out')
          return { status: 'timed_out', runs: result.activeExecutions.map(toRunSnapshot) };
        return inputStopped ? { status: 'stopped' } : { status: 'timed_out', runs: [] };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

const RUN_ERROR_CODES: Readonly<Record<ExecutionFailure['code'], RunFailureCode>> = {
  session_failed: 'SESSION_FAILED',
  context_failed: 'CONTEXT_FAILED',
  model_call_failed: 'MODEL_CALL_FAILED',
  permission_failed: 'PERMISSION_FAILED',
  tool_system_failed: 'TOOL_SYSTEM_FAILED',
  loop_limit_exceeded: 'LOOP_LIMIT_EXCEEDED',
  runtime_protocol_violation: 'RUNTIME_PROTOCOL_VIOLATION',
  cancellation_failed: 'CANCELLATION_FAILED',
  internal_error: 'INTERNAL_ERROR',
};

function toRunError(failure: ExecutionFailure): RunError {
  return {
    code: RUN_ERROR_CODES[failure.code],
    message: failure.message,
    retryable: failure.retryable,
  };
}

function inputFailureCode(code: string): InputFailureCode {
  if (code === 'runtime_stopped') return 'RUNTIME_STOPPED';
  if (code === 'session_busy') return 'RUN_CONFLICT';
  if (code === 'model_not_found' || code === 'model_unavailable' || code === 'model_not_configured')
    return 'MODEL_UNAVAILABLE';
  return 'INPUT_REJECTED';
}

function toRunOutcome(outcome: ExecutionOutcome): AgentRunOutcome {
  return outcome.status === 'failed'
    ? { status: 'failed', error: toRunError(outcome.failure) }
    : { ...outcome };
}

function toRunSnapshot(run: ExecutionSnapshot): AgentRunSnapshot {
  return {
    runId: run.executionId,
    requestId: run.requestId,
    kind: run.kind,
    ...(run.kind === 'conversation'
      ? { sessionId: run.sessionId, workspaceId: run.workspaceId }
      : {}),
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.failure ? { error: toRunError(run.failure) } : {}),
  };
}
