/*
 * Owns the normal conversation submission chain from one raw user input to at
 * most one Agent Execution. Product adapts Host DTOs at the outer boundary;
 * this module owns when Input, Session, branch, and execution operations occur.
 */
import type { Api, Model } from '@megumi/ai';
import type { CommandTerminalResult } from '@megumi/commands';
import type { InputProcessor, RawUserInput } from '@megumi/input';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import type { PermissionMode } from '@megumi/permissions';
import type {
  Session,
  SessionBranchConversationItem,
  SessionBranchDrafts,
  SessionCatalog,
  SessionHistory,
  SessionMessageWithAttachments,
  RecommendationReferenceContent,
} from '@megumi/session';
import type { ConversationExecutionInput, StartExecutionResult } from './agent-executions';
import type { ExecutionOutcome, ExecutionSnapshot } from './execution-registry';

export interface SubmitConversationInputRequest extends RawUserInput {
  readonly requestId?: string;
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly recommendationId?: string;
  readonly sessionTitle?: string;
  readonly branchMarkerId?: string;
  readonly modelSelection: {
    readonly providerId: string;
    readonly modelId: string;
  };
  readonly permissionMode?: PermissionMode;
}

export interface ConversationBranchCommit {
  readonly branchMarkerId: string;
  readonly branch: SessionBranchConversationItem;
}

export interface ConversationSubmissionFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: { readonly owner: string; readonly code: string };
}

export type SubmitConversationInputResult =
  | {
      readonly status: 'agent_started';
      readonly requestId: string;
      readonly session: Session;
      readonly execution: ExecutionSnapshot;
      readonly userMessage: SessionMessageWithAttachments;
      readonly branchCommit?: ConversationBranchCommit;
    }
  | {
      readonly status: 'host_interaction_requested';
      readonly requestId: string;
      readonly session?: Session;
      readonly request: { readonly kind: string };
    }
  | {
      readonly status: 'completed';
      readonly requestId: string;
      readonly session?: Session;
      readonly message?: string;
    }
  | {
      readonly status: 'failed';
      readonly requestId: string;
      readonly session?: Session;
      readonly failure: ConversationSubmissionFailure;
    };

export type ConversationModelResolution =
  | { readonly status: 'ok'; readonly model: Model<Api> }
  | {
      readonly status: 'failed';
      readonly failure: {
        readonly code: string;
        readonly message: string;
        readonly retryable?: boolean;
      };
    };

export interface ConversationSubmissionDependencies {
  readonly input: Pick<InputProcessor<CommandTerminalResult>, 'process'>;
  readonly sessions: Pick<SessionCatalog, 'getSession' | 'createSession'>;
  readonly history: Pick<SessionHistory, 'getCommittedBranch'>;
  readonly branches: Pick<SessionBranchDrafts, 'resolveBranchDraft' | 'commitBranchDraft'>;
  readonly resolveModel: (selection: {
    readonly providerId: string;
    readonly modelId: string;
  }) => Promise<ConversationModelResolution>;
  readonly recommendations?: {
    readRecommendationReference(recommendationId: string): RecommendationReferenceContent | undefined;
  };
  readonly observability?: Observability;
}

export interface ConversationSubmission {
  submit(request: SubmitConversationInputRequest): Promise<SubmitConversationInputResult>;
  /** Waits for every accepted Conversation Trace lifecycle already owned by this coordinator. */
  shutdown(): Promise<void>;
}

type StartedConversation = Extract<
  StartExecutionResult,
  { readonly status: 'started' | 'already_started' }
>;

interface PreparedConversationSubmission {
  readonly result: SubmitConversationInputResult;
  readonly started?: StartedConversation;
}

interface ConversationLifecycleResult {
  readonly result: SubmitConversationInputResult;
  readonly code: string;
  readonly correlation: TraceCorrelation;
  readonly outcome?: ExecutionOutcome;
}

export function createConversationSubmission(options: {
  readonly dependencies: ConversationSubmissionDependencies;
  readonly startExecution: (request: ConversationExecutionInput) => Promise<StartExecutionResult>;
}): ConversationSubmission {
  const activeLifecycles = new Set<Promise<void>>();

  return {
    submit(request) {
      const requestId = request.requestId ?? `request:${crypto.randomUUID()}`;
      const acceptance = deferred<SubmitConversationInputResult>();
      const lifecycle = observeConversationTrace(
        options.dependencies.observability,
        {
          requestId,
          workspaceId: request.workspaceId,
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          ...(request.recommendationId ? { recommendationId: request.recommendationId } : {}),
        },
        async () => {
          try {
            const prepared = await prepareConversationSubmission(options, request, requestId);
            if (prepared.started?.status === 'already_started') {
              safeLinkDuplicate(options.dependencies.observability, requestId, prepared.started);
            }
            acceptance.resolve(prepared.result);
            if (!prepared.started || prepared.started.status === 'already_started') {
              return lifecycleResult(
                prepared,
                request,
                prepared.started?.status ?? conversationResultCode(prepared.result),
              );
            }
            const outcome = await prepared.started.completion;
            return lifecycleResult(prepared, request, outcome.status, outcome);
          } catch (error) {
            acceptance.reject(error);
            throw error;
          }
        },
      );
      trackLifecycle(activeLifecycles, lifecycle);
      return acceptance.promise;
    },

    async shutdown() {
      while (activeLifecycles.size > 0) {
        await Promise.all([...activeLifecycles]);
      }
    },
  };
}

async function prepareConversationSubmission(
  options: {
    readonly dependencies: ConversationSubmissionDependencies;
    readonly startExecution: (request: ConversationExecutionInput) => Promise<StartExecutionResult>;
  },
  request: SubmitConversationInputRequest,
  requestId: string,
): Promise<PreparedConversationSubmission> {
  const { dependencies } = options;
  safeRecordContent(dependencies.observability, 'input.received', toRawUserInput(request), {
    requestId,
    workspaceId: request.workspaceId,
  });
  if (request.sessionId && request.recommendationId) {
    return { result: failure(
      requestId,
      'recommendation_requires_new_session',
      'A Recommendation can only start a new Session.',
    ) };
  }

  const requestedSessionId = request.sessionId;
  const existingSession = requestedSessionId
    ? await observeOperation(
        dependencies.observability,
        'session.resolve',
        { requestId, sessionId: requestedSessionId, workspaceId: request.workspaceId },
        classifySessionResolution,
        () => resolveExistingSession(dependencies.sessions, requestedSessionId, request.workspaceId),
      )
    : undefined;
  if (existingSession?.status === 'failed') {
    return { result: failure(requestId, 'session_resolution_failed', existingSession.message) };
  }

  const model = await observeOperation(
    dependencies.observability,
    'model.resolve',
    { requestId, workspaceId: request.workspaceId },
    classifyModelResolution,
    () => dependencies.resolveModel(request.modelSelection),
  );
  if (model.status === 'failed') {
    return { result: failure(
      requestId,
      model.failure.code,
      model.failure.message,
      existingSession?.session,
      model.failure.retryable,
    ) };
  }

  const processed = await observeOperation(
    dependencies.observability,
    'input.process',
    {
      requestId,
      workspaceId: request.workspaceId,
      ...(existingSession ? { sessionId: existingSession.session.session_id } : {}),
    },
    classifyProcessedInput,
    async () => {
      const result = await dependencies.input.process({
        input: toRawUserInput(request),
        context: {
          workspaceId: request.workspaceId,
          ...(existingSession ? { sessionId: existingSession.session.session_id } : {}),
          model: model.model,
        },
      });
      safeRecordContent(dependencies.observability, 'input.processed', result, { requestId });
      return result;
    },
  );
  if (processed.status === 'failed') {
    return { result: failure(
      requestId,
      processed.failure.code,
      processed.failure.message,
      existingSession?.session,
    ) };
  }
  if (processed.status === 'completed') {
    return { result: terminalResult(requestId, processed.result, existingSession?.session) };
  }

  const requestedRecommendationId = request.recommendationId;
  const recommendationReference = requestedRecommendationId
    ? await observeOperation(
        dependencies.observability,
        'recommendation.reference.resolve',
        { requestId, recommendationId: requestedRecommendationId },
        classifyRecommendationResolution,
        () => resolveRecommendationReference(dependencies, requestedRecommendationId),
      )
    : undefined;
  if (recommendationReference?.status === 'failed') {
    return { result: failure(requestId, recommendationReference.code, recommendationReference.message) };
  }

  const acceptedText = processed.input.displayContent.map((block) => block.text).join('');
  let activeSession = existingSession?.session;
  if (!activeSession) {
    const created = await observeOperation(
      dependencies.observability,
      'session.create',
      { requestId, workspaceId: request.workspaceId },
      classifySessionCreation,
      () => createAcceptedSession(dependencies.sessions, request, acceptedText),
    );
    if (created.status !== 'created') {
      return { result: failure(requestId, 'session_creation_failed', 'Session could not be created.') };
    }
    activeSession = created.session;
  }

  const session = activeSession;
  const requestedBranchMarkerId = request.branchMarkerId;
  const branch = requestedBranchMarkerId
    ? await observeOperation(
        dependencies.observability,
        'session.branch.resolve',
        { requestId, sessionId: session.session_id, workspaceId: session.workspace_id },
        classifyBranchResolution,
        () => resolveBranch(dependencies.branches, session, requestedBranchMarkerId, requestId),
      )
    : { status: 'ok' as const };
  if (branch.status === 'failed') {
    return { result: failure(requestId, 'branch_resolution_failed', branch.message, session) };
  }

  const started = await options.startExecution({
    kind: 'conversation',
    requestId,
    workspaceId: request.workspaceId,
    sessionId: session.session_id,
    ...(branch.parentEntryId ? { parentEntryId: branch.parentEntryId } : {}),
    input: processed.input,
    ...(recommendationReference ? { recommendationReference: recommendationReference.reference } : {}),
    model: model.model,
    permissionMode: request.permissionMode ?? 'ask',
  });
  if (started.status !== 'started' && started.status !== 'already_started') {
    return { result: started.status === 'session_busy'
      ? failure(
          requestId,
          'session_busy',
          'The session already has an active execution.',
          session,
          true,
        )
      : {
          status: 'failed',
          requestId,
          session,
          failure: started.failure,
        } };
  }

  const branchCommit = requestedBranchMarkerId
    ? await observeOperation(
        dependencies.observability,
        'session.branch.commit',
        {
          requestId,
          executionId: started.execution.executionId,
          sessionId: session.session_id,
          workspaceId: session.workspace_id,
        },
        classifyBranchCommit,
        () => commitBranch(
          dependencies,
          requestedBranchMarkerId,
          requestId,
          session,
          started,
        ),
      )
    : undefined;
  return {
    started,
    result: {
      status: 'agent_started',
      requestId,
      session,
      execution: started.execution,
      userMessage: started.userMessage,
      ...(branchCommit ? { branchCommit } : {}),
    },
  };
}

function lifecycleResult(
  prepared: PreparedConversationSubmission,
  request: SubmitConversationInputRequest,
  code: string,
  outcome?: ExecutionOutcome,
): ConversationLifecycleResult {
  const result = prepared.result;
  return {
    result,
    code,
    correlation: {
      requestId: result.requestId,
      workspaceId: request.workspaceId,
      ...(result.session ? { sessionId: result.session.session_id } : {}),
      ...(result.status === 'agent_started'
        ? { executionId: result.execution.executionId }
        : {}),
    },
    ...(outcome ? { outcome } : {}),
  };
}

function conversationResultCode(result: SubmitConversationInputResult): string {
  return result.status === 'failed' ? result.failure.code : result.status;
}

function classifyConversationLifecycle(result: ConversationLifecycleResult): OperationCompletion {
  if (result.outcome?.status === 'completed') {
    return { outcome: { status: 'ok', code: 'completed' }, correlation: result.correlation };
  }
  if (result.outcome?.status === 'cancelled') {
    return { outcome: { status: 'cancelled', code: 'cancelled' }, correlation: result.correlation };
  }
  if (result.outcome?.status === 'failed') {
    return {
      outcome: {
        status: 'error',
        code: result.outcome.failure.code,
        message: result.outcome.failure.message,
        retryable: result.outcome.failure.retryable,
      },
      correlation: result.correlation,
    };
  }
  if (result.result.status === 'failed') {
    if (result.result.failure.code === 'input_cancelled') {
      return {
        outcome: { status: 'cancelled', code: 'input_cancelled' },
        correlation: result.correlation,
      };
    }
    return {
      outcome: {
        status: 'error',
        code: result.result.failure.code,
        message: result.result.failure.message,
        ...(result.result.failure.retryable === undefined
          ? {}
          : { retryable: result.result.failure.retryable }),
      },
      correlation: result.correlation,
    };
  }
  return { outcome: { status: 'ok', code: result.code }, correlation: result.correlation };
}

async function observeConversationTrace(
  observability: Observability | undefined,
  correlation: TraceCorrelation,
  operation: () => Promise<ConversationLifecycleResult>,
): Promise<ConversationLifecycleResult> {
  let operationPromise: Promise<ConversationLifecycleResult> | undefined;
  const runOnce = (): Promise<ConversationLifecycleResult> => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withTrace({
      kind: 'conversation',
      correlation,
      classifyResult: classifyConversationLifecycle,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

async function observeOperation<T>(
  observability: Observability | undefined,
  name: Parameters<Observability['withSpan']>[0]['name'],
  correlation: TraceCorrelation,
  classifyResult: (result: T) => OperationCompletion,
  operation: () => T | Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> => {
    operationPromise ??= Promise.resolve().then(operation);
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({ name, correlation, classifyResult }, runOnce);
  } catch {
    return runOnce();
  }
}

function trackLifecycle(active: Set<Promise<void>>, lifecycle: Promise<unknown>): void {
  let tracked: Promise<void>;
  tracked = lifecycle.then(
    () => undefined,
    () => undefined,
  ).finally(() => { active.delete(tracked); });
  active.add(tracked);
}

function safeRecordContent(
  observability: Observability | undefined,
  kind: 'input.received' | 'input.processed',
  value: unknown,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, correlation });
  } catch {
    // Input processing remains authoritative when diagnostics are unavailable.
  }
}

function safeLinkDuplicate(
  observability: Observability | undefined,
  requestId: string,
  started: StartedConversation,
): void {
  const executionId = started.execution.executionId;
  try {
    observability?.linkTrace({
      kind: 'duplicate',
      target: {
        by: 'correlation',
        traceKind: 'conversation',
        correlation: { requestId, executionId },
        state: 'active',
      },
      correlation: { requestId, executionId },
    });
  } catch {
    // Request idempotency never depends on diagnostic link resolution.
  }
}

function classifyModelResolution(result: ConversationModelResolution): OperationCompletion {
  return result.status === 'ok'
    ? { outcome: { status: 'ok', code: 'resolved' } }
    : { outcome: {
        status: 'error',
        code: result.failure.code,
        message: result.failure.message,
        ...(result.failure.retryable === undefined ? {} : { retryable: result.failure.retryable }),
      } };
}

type SessionResolution = ReturnType<typeof resolveExistingSession>;

function classifySessionResolution(result: SessionResolution): OperationCompletion {
  return result.status === 'ok'
    ? {
        outcome: { status: 'ok', code: 'resolved' },
        correlation: {
          sessionId: result.session.session_id,
          workspaceId: result.session.workspace_id,
        },
      }
    : { outcome: { status: 'error', code: 'session_resolution_failed', message: result.message } };
}

type ProcessedInput = Awaited<
  ReturnType<ConversationSubmissionDependencies['input']['process']>
>;

function classifyProcessedInput(result: ProcessedInput): OperationCompletion {
  if (result.status === 'failed') {
    return { outcome: {
      status: 'error',
      code: result.failure.code,
      message: result.failure.message,
    } };
  }
  if (result.status === 'completed' && result.result.type === 'cancelled') {
    return { outcome: { status: 'cancelled', code: 'input_cancelled' } };
  }
  if (result.status === 'completed' && result.result.type === 'error') {
    return { outcome: {
      status: 'error',
      code: 'input_processing_failed',
      message: result.result.message,
    } };
  }
  return { outcome: { status: 'ok', code: result.status } };
}

type RecommendationResolution = ReturnType<typeof resolveRecommendationReference>;

function classifyRecommendationResolution(result: RecommendationResolution): OperationCompletion {
  return result.status === 'ok'
    ? {
        outcome: { status: 'ok', code: 'resolved' },
        correlation: { recommendationId: result.reference.recommendationId },
      }
    : { outcome: { status: 'error', code: result.code, message: result.message } };
}

type SessionCreation = ReturnType<typeof createAcceptedSession>;

function classifySessionCreation(result: SessionCreation): OperationCompletion {
  return result.status === 'created'
    ? {
        outcome: { status: 'ok', code: 'created' },
        correlation: {
          sessionId: result.session.session_id,
          workspaceId: result.session.workspace_id,
        },
      }
    : { outcome: {
        status: 'error',
        code: result.failure.code,
        message: result.failure.message,
      } };
}

type BranchResolution = ReturnType<typeof resolveBranch>;

function classifyBranchResolution(result: BranchResolution): OperationCompletion {
  return result.status === 'ok'
    ? { outcome: { status: 'ok', code: 'resolved' } }
    : { outcome: { status: 'error', code: 'branch_resolution_failed', message: result.message } };
}

function classifyBranchCommit(result: ConversationBranchCommit | undefined): OperationCompletion {
  return result
    ? { outcome: { status: 'ok', code: 'committed' } }
    : {
        outcome: {
          status: 'error',
          code: 'branch_commit_unavailable',
          message: 'The committed Branch could not be read.',
        },
      };
}

function resolveRecommendationReference(
  dependencies: ConversationSubmissionDependencies,
  recommendationId: string,
): { readonly status: 'ok'; readonly reference: RecommendationReferenceContent }
  | { readonly status: 'failed'; readonly code: string; readonly message: string } {
  let reference: RecommendationReferenceContent | undefined;
  try {
    reference = dependencies.recommendations?.readRecommendationReference(recommendationId);
  } catch {
    return {
      status: 'failed',
      code: 'recommendation_reference_invalid',
      message: 'The Recommendation reference is invalid.',
    };
  }
  if (!reference) {
    return {
      status: 'failed',
      code: 'recommendation_not_found',
      message: 'The Recommendation is missing, hidden, or not published.',
    };
  }
  return {
    status: 'ok',
    reference,
  };
}

function toRawUserInput(request: SubmitConversationInputRequest): RawUserInput {
  return {
    text: request.text,
    ...(request.attachments ? { attachments: request.attachments } : {}),
    ...(request.skillSelection ? { skillSelection: request.skillSelection } : {}),
  };
}

function resolveExistingSession(
  sessions: Pick<SessionCatalog, 'getSession'>,
  sessionId: string,
  workspaceId: string,
): { readonly status: 'ok'; readonly session: Session }
  | { readonly status: 'failed'; readonly message: string } {
  const result = sessions.getSession({ session_id: sessionId });
  if (result.status !== 'found') {
    return {
      status: 'failed',
      message: result.status === 'failed' ? result.failure.message : 'Session was not found.',
    };
  }
  return result.session.workspace_id === workspaceId
    ? { status: 'ok', session: result.session }
    : { status: 'failed', message: 'Session does not belong to the requested Workspace.' };
}

function createAcceptedSession(
  sessions: Pick<SessionCatalog, 'createSession'>,
  request: SubmitConversationInputRequest,
  acceptedText: string,
): ReturnType<Pick<SessionCatalog, 'createSession'>['createSession']> {
  return sessions.createSession({
    workspace_id: request.workspaceId,
    initial_user_text: acceptedText,
    ...(request.sessionTitle ? { title: request.sessionTitle } : {}),
  });
}

function resolveBranch(
  branches: Pick<SessionBranchDrafts, 'resolveBranchDraft'>,
  session: Session,
  branchMarkerId: string | undefined,
  requestId: string,
): { readonly status: 'ok'; readonly parentEntryId?: string }
  | { readonly status: 'failed'; readonly message: string } {
  if (!branchMarkerId) return { status: 'ok' };
  const result = branches.resolveBranchDraft({
    request_id: requestId,
    session_id: session.session_id,
    branch_marker_id: branchMarkerId,
  });
  if (result.status === 'resolved') {
    return { status: 'ok', parentEntryId: result.branch_draft.source_entry_id };
  }
  return {
    status: 'failed',
    message: result.reason === 'branch_marker_not_found'
      ? 'Branch draft was not found.'
      : result.reason === 'branch_marker_already_committed'
        ? 'Branch draft has already been committed by another request.'
        : 'Branch draft does not belong to the active session.',
  };
}

function commitBranch(
  dependencies: ConversationSubmissionDependencies,
  branchMarkerId: string,
  requestId: string,
  session: Session,
  started: Extract<StartExecutionResult, { readonly status: 'started' | 'already_started' }>,
): ConversationBranchCommit | undefined {
  dependencies.branches.commitBranchDraft({
    request_id: requestId,
    session_id: session.session_id,
    branch_marker_id: branchMarkerId,
  });
  const committed = dependencies.history.getCommittedBranch({
    sessionId: session.session_id,
    targetEntryId: started.userEntry.entry_id,
  });
  return committed.status === 'found'
    ? { branchMarkerId, branch: committed.branch }
    : undefined;
}

function terminalResult(
  requestId: string,
  result: CommandTerminalResult,
  session?: Session,
): SubmitConversationInputResult {
  if (result.type === 'host_interaction_request') {
    return {
      status: 'host_interaction_requested',
      requestId,
      ...(session ? { session } : {}),
      request: result.request,
    };
  }
  if (result.type === 'completed') {
    return {
      status: 'completed',
      requestId,
      ...(session ? { session } : {}),
      ...(result.message ? { message: result.message } : {}),
    };
  }
  return failure(
    requestId,
    result.type === 'error' ? 'input_processing_failed' : 'input_cancelled',
    result.type === 'error' ? result.message : 'Input processing was cancelled.',
    session,
  );
}

function failure(
  requestId: string,
  code: string,
  message: string,
  session?: Session,
  retryable = false,
): SubmitConversationInputResult {
  return {
    status: 'failed',
    requestId,
    ...(session ? { session } : {}),
    failure: { code, message, retryable },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
