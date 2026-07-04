// Controller for session operations exposed to UI shells.
import type {
  SessionCreateData,
  SessionCreatePayload,
  SessionMessageListData,
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc';
import type { Run, Session } from '@megumi/shared/session';
import type {
  Session as SessionContract,
  SessionMessageWithAttachments,
  SessionService,
} from '../../session';

export interface SessionController {
  create(payload: SessionCreatePayload): SessionCreateData;
  list(): { sessions: Session[] };
  listMessages(sessionId: string): SessionMessageListData;
  listTimeline(payload: SessionTimelineListPayload): SessionTimelineListData;
  listRuns(sessionId: string): { runs: Run[] };
}

export interface SessionControllerCompatibilityQueries {
  listWorkspaceIds(): string[];
  listTimelineMessagesBySession(payload: SessionTimelineListPayload): SessionTimelineListData;
  listRunsBySession(sessionId: string): Run[];
}

export function createSessionController(
  sessionService: SessionService,
  compatibility: SessionControllerCompatibilityQueries,
): SessionController {
  return {
    create: (payload) => {
      if (!payload.workspaceId) {
        throw new Error('Session create requires workspaceId.');
      }
      const result = sessionService.createSession({
        session_id: `session:${crypto.randomUUID()}`,
        workspace_id: payload.workspaceId,
        title: payload.title,
        created_at: payload.createdAt,
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return { session: toIpcSession(result.session, payload.workspacePath) };
    },
    list: () => {
      const sessions = [];
      for (const workspaceId of compatibility.listWorkspaceIds()) {
        const result = sessionService.listSessions({ workspace_id: workspaceId });
        if (result.status === 'failed') {
          throw new Error(result.failure.message);
        }
        sessions.push(...result.sessions.map((session) => toIpcSession(session)));
      }
      return { sessions };
    },
    listMessages: (sessionId) => {
      const result = sessionService.listMessages({
        session_id: sessionId,
        active_path_only: true,
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return {
        messages: result.messages.map(toIpcMessage),
      };
    },
    listTimeline: (payload) => compatibility.listTimelineMessagesBySession(payload),
    listRuns: (sessionId) => ({ runs: compatibility.listRunsBySession(sessionId) }),
  };
}

function toIpcSession(session: SessionContract, workspacePath?: string): Session {
  return {
    sessionId: session.session_id,
    title: session.title,
    workspaceId: session.workspace_id,
    ...(workspacePath ? { workspacePath } : {}),
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    ...(session.archived_at ? { archivedAt: session.archived_at } : {}),
  };
}

function toIpcMessage(item: SessionMessageWithAttachments): SessionMessageListData['messages'][number] {
  const message = item.message;
  return {
    messageId: message.message_id,
    sessionId: message.session_id,
    runId: message.run_id,
    role: message.role,
    content: message.content_text,
    status: 'completed',
    createdAt: message.created_at,
    ...(message.completed_at ? { completedAt: message.completed_at } : {}),
  };
}
