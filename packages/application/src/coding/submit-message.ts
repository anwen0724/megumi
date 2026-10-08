/* Owns Coding request admission, preparation, cancellation and product completion. */
import type { Observability, SpanName, TraceCorrelation } from '../observability/index';
import type {
  Agent,
  AgentRun,
  ApprovalDecision,
  ApprovalRequest,
  PermissionMode,
} from '@megumi/agent';
import type { Api, Model, Models } from '@megumi/ai';
import { isDeepStrictEqual } from 'node:util';
import type { EventBus } from './events/event-bus';
import type { CommandTerminalResult } from './input/execute-command';
import type { InputProcessor, RawUserInput } from './input/parse-message';
import type { CodingContextOptions } from './prepare-context';
import { createCodingContext } from './prepare-context';
import type { CodingRunPreparation } from './prepare-run';
import { prepareCodingRun } from './prepare-run';
import { createSessionEventObserver } from './events/map-agent-events';
import type { SessionBranchDrafts } from './sessions/session-branches';
import type { Session, SessionCatalog } from './sessions/session-catalog';
import type {
  SessionBranchConversationItem,
  SessionHistory,
  SessionMessageWithAttachments,
} from './sessions/session-history';
import {
  createSessionMessageSaver,
  saveInterruptedReply,
  type SaveUserMessageResult,
} from './sessions/session-history';

export interface SubmitCodingInputRequest extends RawUserInput {
  readonly requestId?: string;
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly sessionTitle?: string;
  readonly branchMarkerId?: string;
  readonly modelSelection?: { readonly providerId: string; readonly modelId: string };
  readonly permissionMode?: PermissionMode;
}

export interface CodingRunSnapshot {
  readonly runId: string;
  readonly requestId: string;
  readonly kind: 'conversation';
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly status: 'running' | 'waiting' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
  readonly createdAt: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export type CodingOutcome =
  | { readonly status: 'completed'; readonly assistantMessageId?: string }
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'failed';
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      };
    };

export interface CodingRunHandle {
  readonly runId: string;
  readonly snapshot: CodingRunSnapshot;
  readonly completion: Promise<CodingOutcome>;
}

export type SubmitCodingInputResult =
  | {
      readonly status: 'started';
      readonly requestId: string;
      readonly session: Session;
      readonly userMessage: SessionMessageWithAttachments;
      readonly run: CodingRunHandle;
      readonly branchCommit?: {
        readonly branchMarkerId: string;
        readonly branch: SessionBranchConversationItem;
      };
    }
  | {
      readonly status: 'completed';
      readonly requestId: string;
      readonly session?: Session;
      readonly message?: string;
    }
  | {
      readonly status: 'host_interaction_requested';
      readonly requestId: string;
      readonly session?: Session;
      readonly request: { readonly kind: string };
    }
  | {
      readonly status: 'rejected';
      readonly requestId: string;
      readonly session?: Session;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface Coding {
  /** Accepts one product request, including preparation, before an Agent run exists. */
  submitInput(request: SubmitCodingInputRequest): Promise<SubmitCodingInputResult>;
  /** Cancels the same request throughout preparation, execution and product finalization. */
  cancelInput(requestId: string): boolean;
  getRun(runId: string): CodingRunSnapshot | undefined;
  getSessionRun(sessionId: string): CodingRunSnapshot | undefined;
  /** Stops accepting requests and waits for admitted product work. */
  shutdown(): Promise<void>;
}

export interface CreateCodingOptions {
  readonly memory?: () => Pick<import('../memory/contracts').MemoryHost, 'createTaskMemory' | 'recordUsage'>;
  readonly observability?: Observability;
  readonly ai: Pick<Models, 'streamSimple' | 'completeSimple'>;
  readonly agent: Agent;
  readonly sessions: SessionCatalog;
  readonly history: SessionHistory;
  readonly branches: SessionBranchDrafts;
  readonly input: InputProcessor<CommandTerminalResult>;
  readonly preparation: CodingRunPreparation;
  readonly context: Pick<
    CodingContextOptions,
    'attachments' | 'megumiHomePath' | 'instructionDocuments' | 'readInstructionPolicy' | 'skills'
  >;
  readonly events: EventBus;
  readonly terminalRetentionMs: number;
  readonly resolveModel: (
    workspaceId: string,
    selection?: SubmitCodingInputRequest['modelSelection'],
  ) => Promise<
    | {
        readonly status: 'ok';
        readonly model: Model<Api>;
        readonly compactionThresholdRatio: number;
      }
    | {
        readonly status: 'failed';
        readonly failure: { readonly code: string; readonly message: string };
      }
  >;
  readonly awaitApproval?: (
    request: ApprovalRequest,
    session: Session,
  ) => Promise<ApprovalDecision>;
  readonly finalize: (run: CodingRunSnapshot) => Promise<void>;
  readonly onCompleted?: (turn: {
    sessionId: string;
    executionId: string;
    userMessageId: string;
    assistantMessageId: string;
    completedAt: string;
  }) => void;
}

/** Creates the Coding product around the already-bound Agent service. */
export function createCoding(options: CreateCodingOptions): Coding {
  const requests = new Map<string, CodingRequest>();
  const occupied = new Map<string, CodingRequest>();
  let stopped = false;

  async function submit(request: SubmitCodingInputRequest): Promise<SubmitCodingInputResult> {
    const requestId = request.requestId ?? crypto.randomUUID();
    if (stopped)
      return rejected(requestId, 'RUNTIME_STOPPED', 'Coding has stopped accepting requests.');
    for (const [id, item] of requests) {
      if (item.completedAt && Date.now() - item.completedAt >= options.terminalRetentionMs)
        requests.delete(id);
    }
    const owned = structuredClone({ ...request, requestId });
    const existing = requests.get(requestId);
    if (existing)
      return isDeepStrictEqual(existing.request, owned)
        ? existing.submission
        : rejected(
            requestId,
            'RUN_CONFLICT',
            'Request identity already belongs to different input.',
          );
    if (request.sessionId && occupied.has(request.sessionId)) {
      return rejected(requestId, 'RUN_CONFLICT', 'The session already has an active request.');
    }
    const submission = deferred<SubmitCodingInputResult>();
    const entry: CodingRequest = {
      request: owned,
      controller: new AbortController(),
      createdAt: new Date().toISOString(),
      submission: submission.promise,
      completion: Promise.resolve({ status: 'cancelled' }),
    };
    requests.set(requestId, entry);
    if (request.sessionId) occupied.set(request.sessionId, entry);
    const executeRequest = async (): Promise<CodingOutcome> => {
      try {
        const started = await prepareAndStart(entry);
        submission.resolve(started);
        if (started.status === 'started') return await started.run.completion;
        return started.status === 'rejected'
          ? { status: 'failed', error: { ...started.error, retryable: false } }
          : { status: 'completed' };
      } catch (cause) {
        const error = {
          code: 'INPUT_REJECTED',
          retryable: false,
          message: cause instanceof Error ? cause.message : 'Coding input could not be prepared.',
        };
        submission.resolve(
          rejected(
            requestId,
            entry.controller.signal.aborted ? 'INPUT_CANCELLED' : error.code,
            error.message,
            entry.session,
          ),
        );
        return entry.controller.signal.aborted
          ? { status: 'cancelled' }
          : { status: 'failed', error };
      } finally {
        entry.completedAt = Date.now();
        const sessionId = entry.session?.session_id ?? entry.request.sessionId;
        if (sessionId && occupied.get(sessionId) === entry) occupied.delete(sessionId);
      }
    };
    entry.completion = options.observability
      ? options.observability.withTrace(
          {
            kind: 'conversation',
            correlation: { requestId, workspaceId: owned.workspaceId, sessionId: owned.sessionId },
            classifyResult: (outcome) => ({
              outcome:
                outcome.status === 'failed'
                  ? { status: 'error', ...outcome.error }
                  : { status: outcome.status === 'completed' ? 'ok' : 'cancelled' },
              correlation: { executionId: entry.run?.runId, sessionId: entry.session?.session_id },
            }),
          },
          executeRequest,
        )
      : executeRequest();
    return submission.promise;
  }

  /** Preparation belongs to the product; Agent receives only the completed configuration. */
  async function prepareAndStart(entry: CodingRequest): Promise<SubmitCodingInputResult> {
    const request = entry.request;
    const signal = entry.controller.signal;
    recordInput('input.received', request, request.requestId);
    if (request.sessionId) {
      const found = options.sessions.getSession({ session_id: request.sessionId });
      if (found.status !== 'found' || found.session.workspace_id !== request.workspaceId) {
        return rejected(
          request.requestId,
          'INPUT_REJECTED',
          'Session does not belong to the requested workspace.',
        );
      }
      entry.session = found.session;
    }
    const selected = await observe('model.resolve', { requestId: request.requestId }, () =>
      options.resolveModel(
        request.workspaceId,
        request.modelSelection ?? entry.session?.model_selection,
      ),
    );
    signal.throwIfAborted();
    if (selected.status === 'failed')
      return rejected(
        request.requestId,
        selected.failure.code,
        selected.failure.message,
        entry.session,
      );
    const processed = await observe('input.process', { requestId: request.requestId }, () =>
      options.input.process(
        {
          input: request,
          context: {
            workspaceId: request.workspaceId,
            sessionId: entry.session?.session_id,
            model: selected.model,
            client: options.ai,
            compactionThresholdRatio: selected.compactionThresholdRatio,
          },
        },
        { signal },
      ),
    );
    recordInput('input.processed', processed, request.requestId);
    signal.throwIfAborted();
    if (processed.status === 'failed')
      return rejected(
        request.requestId,
        processed.failure.code,
        processed.failure.message,
        entry.session,
      );
    if (processed.status === 'completed') {
      const result = processed.result;
      if (result.type === 'completed')
        return {
          status: 'completed',
          requestId: request.requestId,
          session: entry.session,
          message: result.message,
        };
      if (result.type === 'host_interaction_request')
        return {
          status: 'host_interaction_requested',
          requestId: request.requestId,
          session: entry.session,
          request: result.request,
        };
      return rejected(
        request.requestId,
        'INPUT_REJECTED',
        result.type === 'error' ? result.message : 'Input was cancelled.',
        entry.session,
      );
    }
    if (!entry.session) {
      const created = options.sessions.createSession({
        workspace_id: request.workspaceId,
        title: request.sessionTitle,
        initial_user_text: processed.input.displayContent.map((block) => block.text).join(''),
        model_selection: { providerId: selected.model.provider, modelId: selected.model.id },
      });
      if (created.status === 'failed')
        return rejected(request.requestId, created.failure.code, created.failure.message);
      entry.session = created.session;
      occupied.set(created.session.session_id, entry);
    } else if (request.modelSelection || !entry.session.model_selection) {
      const updated = options.sessions.updateModelSelection({
        session_id: entry.session.session_id,
        model_selection: { providerId: selected.model.provider, modelId: selected.model.id },
      });
      if (updated.status !== 'found')
        throw new Error('Session model selection could not be saved.');
      entry.session = updated.session;
    }
    const session = entry.session;
    const branch = request.branchMarkerId
      ? options.branches.resolveBranchDraft({
          request_id: request.requestId,
          session_id: session.session_id,
          branch_marker_id: request.branchMarkerId,
        })
      : undefined;
    if (branch && branch.status !== 'resolved')
      return rejected(request.requestId, 'INPUT_REJECTED', 'Branch draft is unavailable.', session);
    const preparedConfig = await prepareCodingRun(
      { session, model: selected.model, permissionMode: request.permissionMode ?? 'ask', signal },
      options.preparation,
    );
    signal.throwIfAborted();
    const memory = options.memory?.();
    const taskMemory = memory?.createTaskMemory({ workspaceId: session.workspace_id,
      workspaceDirectory: preparedConfig.environment.workingDirectory,
      inputBudgetTokens: Math.max(0, selected.model.contextWindow - selected.model.maxTokens) });
    const config = taskMemory ? { ...preparedConfig, tools: [...preparedConfig.tools, ...taskMemory.tools] } : preparedConfig;
    const accepted = deferred<Extract<SaveUserMessageResult, { status: 'saved' }>>();
    const input = processed.input;
    const awaitApproval = options.awaitApproval;
    const saveMessage = createSessionMessageSaver({
      history: options.history,
      ...(taskMemory ? { memoryEvidence: () => taskMemory.evidence(), onReplySaved: () => { memory?.recordUsage(); } } : {}),
      onUserSaved: accepted.resolve,
      user: {
        session_id: session.session_id,
        parent_entry_id:
          branch?.status === 'resolved' ? branch.branch_draft.source_entry_id : undefined,
        display_content: [...input.displayContent],
        model_content: [...input.modelContent],
        skill_selection: input.skillSelection && {
          name: input.skillSelection.name,
          skill_path: input.skillSelection.skillPath,
        },
        attachments: input.attachments.map((attachment) =>
          attachment.type === 'image'
            ? {
                type: 'image',
                name: attachment.name,
                media_type: attachment.mediaType,
                byte_length: attachment.byteLength,
                bytes: attachment.bytes,
              }
            : {
                type: 'file',
                name: attachment.name,
                media_type: attachment.mediaType,
                local_path: attachment.localPath,
                size_bytes: attachment.sizeBytes,
              },
        ),
      },
    });
    entry.run = options.agent.startAgent({
      config,
      signal,
      onEvent: createSessionEventObserver({
        sessionId: session.session_id,
        events: options.events,
        userText: input.displayContent.map((block) => block.text).join(''),
      }),
      input: {
        role: 'user',
        content: input.modelContent.map((block) => ({ ...block })),
        timestamp: Date.now(),
      },
      context: createCodingContext({
        ...options.context,
        ...(taskMemory ? { memory: { task: taskMemory, executionId: () => {
          if (!entry.run) throw new Error('Coding execution identity is unavailable.');
          return entry.run.runId;
        } } } : {}),
        sessionId: session.session_id,
        workspaceId: session.workspace_id,
        config,
        history: options.history,
        ai: options.ai,
        compactionThresholdRatio: selected.compactionThresholdRatio,
        events: options.events,
        observability: options.observability,
      }),
      saveMessage: (message) =>
        observe(
          'session.message.commit',
          {
            sessionId: session.session_id,
            executionId: message.runId,
            messageId: message.messageId,
            toolCallId:
              message.message.role === 'toolResult' ? message.message.toolCallId : undefined,
          },
          () => saveMessage(message),
        ),
      awaitApproval: awaitApproval && ((approval) => awaitApproval(approval, session)),
    });
    const run = entry.run;
    options.events.publish({
      type: 'run.started',
      sessionId: session.session_id,
      executionId: run.runId,
      payload: {
        requestId: request.requestId,
        providerId: config.model.provider,
        modelId: config.model.id,
      },
    });
    const completion = completeRequest(entry, run);
    const saved = await Promise.race([accepted.promise, completion.then(() => undefined)]);
    if (!saved) {
      const result = await completion;
      return rejected(
        request.requestId,
        result.status === 'failed' ? result.error.code : 'INPUT_CANCELLED',
        result.status === 'failed' ? result.error.message : 'Input was cancelled before saving.',
        session,
      );
    }
    let branchCommit: Extract<SubmitCodingInputResult, { status: 'started' }>['branchCommit'];
    if (request.branchMarkerId) {
      options.branches.commitBranchDraft({
        request_id: request.requestId,
        session_id: session.session_id,
        branch_marker_id: request.branchMarkerId,
      });
      const committed = options.history.getCommittedBranch({
        sessionId: session.session_id,
        targetEntryId: saved.entry.entry_id,
      });
      if (committed.status === 'found')
        branchCommit = { branchMarkerId: request.branchMarkerId, branch: committed.branch };
    }
    return {
      status: 'started',
      requestId: request.requestId,
      session,
      userMessage: saved.message,
      branchCommit,
      run: { runId: run.runId, snapshot: runSnapshot(entry, run, session), completion },
    };
  }

  /** Agent completion precedes mandatory product finalization and release of the session. */
  async function completeRequest(entry: CodingRequest, run: AgentRun): Promise<CodingOutcome> {
    const result = await run.completion;
    const session = entry.session;
    if (!session) throw new Error('An active Coding run must belong to a session.');
    let outcome: CodingOutcome =
      result.status === 'failed'
        ? { status: 'failed', error: result.error }
        : { status: result.status };
    try {
      saveInterruptedReply({ history: options.history, sessionId: session.session_id, result });
    } catch (cause) {
      outcome = {
        status: 'failed',
        error: {
          code: 'MESSAGE_SAVE_FAILED',
          message: cause instanceof Error ? cause.message : 'Could not save the interrupted reply.',
          retryable: false,
        },
      };
    }
    try {
      await options.finalize(runSnapshot(entry, run, session));
    } catch (cause) {
      outcome = {
        status: 'failed',
        error: {
          code: 'CLEANUP_FAILED',
          message: cause instanceof Error ? cause.message : 'Coding finalization failed.',
          retryable: false,
        },
      };
    }
    if (outcome.status !== 'failed' && entry.controller.signal.aborted)
      outcome = { status: 'cancelled' };
    entry.completedAt = Date.now();
    occupied.delete(session.session_id);
    const committed = options.history.getCommittedRunMessages({
      sessionId: session.session_id,
      executionId: run.runId,
    });
    const reply =
      committed.status === 'ok'
        ? committed.messages.find((item) => item.message.message_kind === 'assistant_reply')
        : undefined;
    if (outcome.status === 'completed')
      outcome = { ...outcome, assistantMessageId: reply?.message.message_id };
    entry.outcome = outcome;
    const user =
      committed.status === 'ok'
        ? committed.messages.find((item) => item.message.message_kind === 'user_message')
        : undefined;
    if (outcome.status === 'completed' && user && reply)
      options.onCompleted?.({
        sessionId: session.session_id,
        executionId: run.runId,
        userMessageId: user.message.message_id,
        assistantMessageId: reply.message.message_id,
        completedAt: new Date(entry.completedAt).toISOString(),
      });
    options.events.publish({
      type: 'run.ended',
      sessionId: session.session_id,
      executionId: run.runId,
      payload: {
        status: outcome.status,
        error: outcome.status === 'failed' ? outcome.error : undefined,
        assistantMessageId: reply?.message.message_id,
      },
    });
    return outcome;
  }

  /** Trace failures cannot skip or repeat product work. */
  async function observe<T>(
    name: SpanName,
    correlation: TraceCorrelation,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!options.observability) return operation();
    let pending: Promise<T> | undefined;
    const once = () => (pending ??= Promise.resolve().then(operation));
    try {
      await options.observability.withSpan({ name, correlation }, once);
    } catch {
      /* The operation below retains its own success or failure. */
    }
    return once();
  }

  function recordInput(
    kind: 'input.received' | 'input.processed',
    value: unknown,
    requestId: string,
  ): void {
    try {
      options.observability?.recordContent({ kind, value, correlation: { requestId } });
    } catch {
      /* Diagnostic storage does not change input acceptance. */
    }
  }

  return {
    submitInput: submit,
    cancelInput(requestId) {
      const entry = requests.get(requestId);
      if (!entry || entry.completedAt) return false;
      entry.controller.abort();
      if (entry.run && entry.session)
        options.events.publish({
          type: 'run.cancel.requested',
          sessionId: entry.session.session_id,
          executionId: entry.run.runId,
          payload: { requestedBy: 'user', reason: 'user_cancelled', scope: 'run' },
        });
      return true;
    },
    getRun(runId) {
      const entry = [...requests.values()].find((item) => item.run?.runId === runId);
      return entry?.run && entry.session ? runSnapshot(entry, entry.run, entry.session) : undefined;
    },
    getSessionRun(sessionId) {
      const entry = occupied.get(sessionId);
      return entry?.run && entry.session ? runSnapshot(entry, entry.run, entry.session) : undefined;
    },
    async shutdown() {
      stopped = true;
      for (const entry of requests.values()) if (!entry.completedAt) entry.controller.abort();
      await Promise.all([...requests.values()].map((entry) => entry.completion));
    },
  };
}

interface CodingRequest {
  readonly request: SubmitCodingInputRequest & { readonly requestId: string };
  readonly controller: AbortController;
  readonly createdAt: string;
  readonly submission: Promise<SubmitCodingInputResult>;
  completion: Promise<CodingOutcome>;
  session?: Session;
  run?: AgentRun;
  outcome?: CodingOutcome;
  completedAt?: number;
}

/** The run status is a projection; this product never advances Agent's mutable state. */
function runSnapshot(entry: CodingRequest, run: AgentRun, session: Session): CodingRunSnapshot {
  const snapshot = run.snapshot();
  const activeStatus = entry.controller.signal.aborted
    ? 'cancelling'
    : snapshot.status === 'waiting'
      ? 'waiting'
      : 'running';
  return {
    runId: run.runId,
    requestId: entry.request.requestId,
    kind: 'conversation',
    sessionId: session.session_id,
    workspaceId: session.workspace_id,
    status: entry.outcome?.status ?? activeStatus,
    createdAt: entry.createdAt,
    startedAt: entry.createdAt,
    completedAt: entry.completedAt ? new Date(entry.completedAt).toISOString() : undefined,
    error: entry.outcome?.status === 'failed' ? entry.outcome.error : undefined,
  };
}

function rejected(
  requestId: string,
  code: string,
  message: string,
  session?: Session,
): SubmitCodingInputResult {
  return { status: 'rejected', requestId, session, error: { code, message } };
}

/** Resolving happens after construction; callers only retain the completed promise capability. */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
