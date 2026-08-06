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
  SessionMessageWithAttachments,
} from '@megumi/session';
import { sessionMessageText } from '@megumi/session';
import type { TimelineUserMessage } from '@megumi/projections';
import type {
  ChatRunUiDto,
  ChatSendUserInputUiRequest,
  ChatSendUserInputUiResult,
  ChatSessionUiDto,
} from './host/chat-contract';

export interface InputSubmission {
  submit(request: ChatSendUserInputUiRequest): Promise<ChatSendUserInputUiResult>;
}

export type ProductModelResolver = (request: {
  provider_id: string;
  model_id: string;
}) => Promise<
  | { status: 'ok'; model: Run['model'] }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } }
>;

export function createInputSubmission(options: {
  runs: Pick<Runs, 'start'>;
  input: Pick<InputProcessor<CommandTerminalResult>, 'process'>;
  sessions: Pick<SessionCatalog, 'getSession' | 'createSession'>;
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
      if (request.branchMarkerId && (started.status === 'started' || started.status === 'already_started')) {
        options.branches.commitBranchDraft({
          request_id: requestId,
          session_id: session.session_id,
          branch_marker_id: request.branchMarkerId,
        });
      }
      return mapRunStart(started, requestId, session);
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
  request: ChatSendUserInputUiRequest,
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
): ChatSendUserInputUiResult {
  const sessionDto = session ? { session: toChatSession(session) } : {};
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

function mapRunStart(result: StartRunResult, requestId: string, session: Session): ChatSendUserInputUiResult {
  if (result.status === 'started' || result.status === 'already_started') {
    return {
      payload: {
        type: 'agent_run',
        session: toChatSession(session),
        requestId,
        userMessageId: result.userMessage.message.message_id,
        userMessage: toTimelineUserMessage(session.workspace_id, result.userMessage),
        run: toChatRun(result.run),
      },
    };
  }
  return inputError(
    requestId,
    result.status === 'session_busy' ? 'The session already has an active Run.' : result.failure.message,
    session,
  );
}

function inputError(requestId: string, message: string, session?: Session): ChatSendUserInputUiResult {
  return { payload: { type: 'error', ...(session ? { session: toChatSession(session) } : {}), requestId, message } };
}

function toChatSession(session: Session): ChatSessionUiDto {
  return {
    id: session.session_id,
    projectId: session.workspace_id,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

function toChatRun(run: Run): ChatRunUiDto {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    status: run.status,
    createdAt: run.createdAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
  };
}

function toTimelineUserMessage(projectId: string, item: SessionMessageWithAttachments): TimelineUserMessage {
  const message = item.message;
  return {
    messageId: message.message_id,
    role: 'user',
    projectId,
    sessionId: message.session_id,
    ...(message.run_id ? { runId: message.run_id } : {}),
    ...('skill_selection' in message && message.skill_selection
      ? { skillSelection: { name: message.skill_selection.name, skillPath: message.skill_selection.skill_path } }
      : {}),
    createdAt: message.created_at,
    ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
    blocks: [{
      blockId: `user-text:${message.message_id}`,
      kind: 'user_text',
      text: sessionMessageText(message),
      format: 'plain',
      createdAt: message.created_at,
    }, ...item.attachments.map((attachment) => ({
      blockId: `user-attachment:${attachment.attachment_id}`,
      kind: 'user_attachment' as const,
      attachmentId: attachment.attachment_id,
      attachmentType: attachment.type,
      name: attachment.name ?? attachment.attachment_id,
      ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
      source: attachment.source_type === 'local_file' ? 'local_file' as const : 'unknown' as const,
      createdAt: attachment.created_at,
    }))],
  };
}
