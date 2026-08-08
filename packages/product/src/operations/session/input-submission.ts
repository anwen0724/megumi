/*
 * Owns exactly one user submission path from Input processing to Engine start.
 * It creates no Session until Input accepts the submission for an Agent Run.
 */
import type { CommandTerminalResult } from '@megumi/commands';
import type { Run, Runs, StartRunResult } from '@megumi/engine';
import type { InputProcessor } from '@megumi/input';
import type {
  Session,
  SessionBranchDrafts,
  SessionCatalog,
  SessionHistory,
} from '@megumi/session';
import type {
  SendUserInputRequest,
  SendUserInputResult,
  SessionBranchConversationItemDto,
} from '../../host/session-host';
import { toRunDto, toSessionDto, toUserMessageDto } from './session-reader';

export interface InputSubmission {
  /** Processes one user input and starts at most one idempotent Engine Run. */
  submit(request: SendUserInputRequest): Promise<SendUserInputResult>;
}

export type ProductModelResolver = (request: {
  provider_id: string;
  model_id: string;
}) => Promise<
  | { status: 'ok'; model: Run['model'] }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } }
>;

/** Creates the single Product operation that owns the Input-to-Run submission chain. */
export function createInputSubmission(options: {
  runs: Pick<Runs, 'start'>;
  input: Pick<InputProcessor<CommandTerminalResult>, 'process'>;
  sessions: Pick<SessionCatalog, 'getSession' | 'createSession'>;
  history: Pick<SessionHistory, 'getCommittedBranch'>;
  branches: Pick<SessionBranchDrafts, 'resolveBranchDraft' | 'commitBranchDraft'>;
  resolveModel: ProductModelResolver;
}): InputSubmission {
  return {
    async submit(request) {
      const requestId = request.requestId ?? `request:${crypto.randomUUID()}`;
      const existingSession = request.sessionId
        ? resolveExistingSession(options.sessions, request.sessionId, request.projectId)
        : undefined;
      if (existingSession?.status === 'failed') return inputError(requestId, existingSession.message);

      // Model is an InputContext fact. It is resolved before Input, while new
      // Session creation remains deferred until the single Input call accepts.
      const model = await options.resolveModel(request.modelSelection);
      if (model.status === 'failed') return inputError(requestId, model.failure.message, existingSession?.session);
      const processed = await options.input.process({
        input: {
          text: request.text,
          ...(request.attachments ? {
            attachments: request.attachments.map((attachment) => ({
              draftAttachmentId: attachment.draftAttachmentId,
              type: attachment.type,
              ...(attachment.name ? { name: attachment.name } : {}),
              ...(attachment.declaredMimeType ? { declaredMimeType: attachment.declaredMimeType } : {}),
              source: { type: attachment.source.type, referenceId: attachment.source.referenceId },
            })),
          } : {}),
          ...(request.skillSelection ? { skillSelection: request.skillSelection } : {}),
        },
        context: {
          workspaceId: request.projectId,
          ...(existingSession ? { sessionId: existingSession.session.session_id } : {}),
          model: model.model,
        },
      });
      if (processed.status === 'failed') return inputError(requestId, processed.failure.message, existingSession?.session);
      if (processed.status === 'completed') return commandResult(requestId, processed.result, existingSession?.session);

      const acceptedText = processed.input.displayContent.map((block) => block.text).join('');
      const session = existingSession?.session ?? createAcceptedSession(options.sessions, request, acceptedText);
      if (!session) return inputError(requestId, 'Session could not be created.');
      const branch = resolveBranch(options.branches, session, request.branchMarkerId, requestId);
      if (branch.status === 'failed') return inputError(requestId, branch.message, session);
      const started = await options.runs.start({
        requestId,
        workspaceId: request.projectId,
        sessionId: session.session_id,
        ...(branch.parentEntryId ? { parentEntryId: branch.parentEntryId } : {}),
        input: processed.input,
        model: model.model,
        permissionMode: request.permissionMode ?? 'ask',
      });
      let branchCommit: {
        readonly branchMarkerId: string;
        readonly branch: SessionBranchConversationItemDto;
      } | undefined;
      if (request.branchMarkerId && (started.status === 'started' || started.status === 'already_started')) {
        options.branches.commitBranchDraft({
          request_id: requestId,
          session_id: session.session_id,
          branch_marker_id: request.branchMarkerId,
        });
        const committed = options.history.getCommittedBranch({
          sessionId: session.session_id,
          targetEntryId: started.userEntry.entry_id,
        });
        if (committed.status === 'found') {
          branchCommit = {
            branchMarkerId: request.branchMarkerId,
            branch: {
              type: 'branch',
              branchId: committed.branch.branchId,
              sourceMessageId: committed.branch.sourceMessageId,
              targetMessageId: committed.branch.targetMessageId,
              createdAt: committed.branch.createdAt,
            },
          };
        }
      }
      return mapRunStart(started, requestId, session, branchCommit);
    },
  };
}

function resolveExistingSession(
  sessions: Pick<SessionCatalog, 'getSession'>,
  sessionId: string,
  workspaceId: string,
): { status: 'ok'; session: Session } | { status: 'failed'; message: string } {
  const result = sessions.getSession({ session_id: sessionId });
  if (result.status !== 'found') {
    return { status: 'failed', message: result.status === 'failed' ? result.failure.message : 'Session was not found.' };
  }
  return result.session.workspace_id === workspaceId
    ? { status: 'ok', session: result.session }
    : { status: 'failed', message: 'Session does not belong to the requested Workspace.' };
}

function createAcceptedSession(
  sessions: Pick<SessionCatalog, 'createSession'>,
  request: SendUserInputRequest,
  acceptedText: string,
): Session | undefined {
  const result = sessions.createSession({
    workspace_id: request.projectId,
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
): { status: 'ok'; parentEntryId?: string } | { status: 'failed'; message: string } {
  if (!branchMarkerId) return { status: 'ok' };
  const result = branches.resolveBranchDraft({
    request_id: requestId,
    session_id: session.session_id,
    branch_marker_id: branchMarkerId,
  });
  if (result.status === 'resolved') return { status: 'ok', parentEntryId: result.branch_draft.source_entry_id };
  return {
    status: 'failed',
    message: result.reason === 'branch_marker_not_found'
      ? 'Branch draft was not found.'
      : result.reason === 'branch_marker_already_committed'
        ? 'Branch draft has already been committed by another request.'
        : 'Branch draft does not belong to the active session.',
  };
}

function commandResult(
  requestId: string,
  result: CommandTerminalResult,
  session?: Session,
): SendUserInputResult {
  const sessionDto = session ? { session: toSessionDto(session) } : {};
  if (result.type === 'host_interaction_request') {
    return { payload: { type: 'host_interaction_request', ...sessionDto, requestId, request: result.request } };
  }
  if (result.type === 'completed') {
    return { payload: { type: 'completed', ...sessionDto, requestId, ...(result.message ? { message: result.message } : {}) } };
  }
  return {
    payload: {
      type: 'error',
      ...sessionDto,
      requestId,
      message: result.type === 'error' ? result.message : 'Input processing was cancelled.',
    },
  };
}

function mapRunStart(
  result: StartRunResult,
  requestId: string,
  session: Session,
  branchCommit?: {
    readonly branchMarkerId: string;
    readonly branch: SessionBranchConversationItemDto;
  },
): SendUserInputResult {
  if (result.status === 'started' || result.status === 'already_started') {
    if (result.userMessage.message.message_kind !== 'user_message') {
      throw new Error('Engine returned a non-user message for a started Run.');
    }
    return {
      payload: {
        type: 'agent_run',
        session: toSessionDto(session),
        requestId,
        userMessageId: result.userMessage.message.message_id,
        userMessage: toUserMessageDto({
          message: result.userMessage.message,
          attachments: result.userMessage.attachments,
        }),
        run: toRunDto(result.run),
        ...(branchCommit ? { branchCommit } : {}),
      },
    };
  }
  return inputError(
    requestId,
    result.status === 'session_busy' ? 'The session already has an active Run.' : result.failure.message,
    session,
  );
}

function inputError(requestId: string, message: string, session?: Session): SendUserInputResult {
  return { payload: { type: 'error', ...(session ? { session: toSessionDto(session) } : {}), requestId, message } };
}
