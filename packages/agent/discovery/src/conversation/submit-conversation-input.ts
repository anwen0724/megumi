/*
 * Owns the normal conversation submission chain from one raw user input to at
 * most one Agent Execution. Product adapts Host DTOs at the outer boundary;
 * this module owns when Input, Session, branch, and execution operations occur.
 */
import type { Api, Model } from '@megumi/ai';
import type { CommandTerminalResult } from '@megumi/commands';
import type { InputProcessor, RawUserInput } from '@megumi/input';
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
import type { StartExecutionRequest, StartExecutionResult } from '@megumi/execution';
import type { ExecutionSnapshot } from '@megumi/execution';

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
}

export interface ConversationSubmission {
  submit(request: SubmitConversationInputRequest): Promise<SubmitConversationInputResult>;
}

export function createConversationSubmission(options: {
  readonly dependencies: ConversationSubmissionDependencies;
  readonly startExecution: (request: StartExecutionRequest) => Promise<StartExecutionResult>;
}): ConversationSubmission {
  return {
    async submit(request) {
      const requestId = request.requestId ?? `request:${crypto.randomUUID()}`;
      if (request.sessionId && request.recommendationId) {
        return failure(
          requestId,
          'recommendation_requires_new_session',
          'A Recommendation can only start a new Session.',
        );
      }
      const existingSession = request.sessionId
        ? resolveExistingSession(
            options.dependencies.sessions,
            request.sessionId,
            request.workspaceId,
          )
        : undefined;
      if (existingSession?.status === 'failed') {
        return failure(requestId, 'session_resolution_failed', existingSession.message);
      }

      const model = await options.dependencies.resolveModel(request.modelSelection);
      if (model.status === 'failed') {
        return failure(
          requestId,
          model.failure.code,
          model.failure.message,
          existingSession?.session,
          model.failure.retryable,
        );
      }

      const processed = await options.dependencies.input.process({
        input: toRawUserInput(request),
        context: {
          workspaceId: request.workspaceId,
          ...(existingSession ? { sessionId: existingSession.session.session_id } : {}),
          model: model.model,
        },
      });
      if (processed.status === 'failed') {
        return failure(
          requestId,
          processed.failure.code,
          processed.failure.message,
          existingSession?.session,
        );
      }
      if (processed.status === 'completed') {
        return terminalResult(requestId, processed.result, existingSession?.session);
      }

      const recommendationReference = request.recommendationId
        ? resolveRecommendationReference(options.dependencies, request.recommendationId)
        : undefined;
      if (recommendationReference?.status === 'failed') {
        return failure(requestId, recommendationReference.code, recommendationReference.message);
      }

      const acceptedText = processed.input.displayContent.map((block) => block.text).join('');
      const session = existingSession?.session
        ?? createAcceptedSession(options.dependencies.sessions, request, acceptedText);
      if (!session) {
        return failure(requestId, 'session_creation_failed', 'Session could not be created.');
      }

      const branch = resolveBranch(
        options.dependencies.branches,
        session,
        request.branchMarkerId,
        requestId,
      );
      if (branch.status === 'failed') {
        return failure(requestId, 'branch_resolution_failed', branch.message, session);
      }

      const started = await options.startExecution({
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
        return started.status === 'session_busy'
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
            };
      }

      const branchCommit = request.branchMarkerId
        ? commitBranch(
            options.dependencies,
            request.branchMarkerId,
            requestId,
            session,
            started,
          )
        : undefined;
      return {
        status: 'agent_started',
        requestId,
        session,
        execution: started.execution,
        userMessage: started.userMessage,
        ...(branchCommit ? { branchCommit } : {}),
      };
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
): Session | undefined {
  const result = sessions.createSession({
    workspace_id: request.workspaceId,
    initial_user_text: acceptedText,
    ...(request.sessionTitle ? { title: request.sessionTitle } : {}),
  });
  return result.status === 'created' ? result.session : undefined;
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
