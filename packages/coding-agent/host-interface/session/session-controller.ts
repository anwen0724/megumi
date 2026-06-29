// Controller for session operations exposed to UI shells.
import type {
  SessionCreateData,
  SessionCreatePayload,
  SessionMessageListData,
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc';
import type { Run, Session } from '@megumi/shared/session';
import type { SessionServicePort } from '../../session';

export interface SessionController {
  create(payload: SessionCreatePayload): SessionCreateData;
  list(): { sessions: Session[] };
  listMessages(sessionId: string): SessionMessageListData;
  listTimeline(payload: SessionTimelineListPayload): SessionTimelineListData;
  listRuns(sessionId: string): { runs: Run[] };
}

export function createSessionController(
  sessionService: SessionServicePort,
): SessionController {
  return {
    create: (payload) => ({ session: sessionService.createSession(payload) }),
    list: () => ({ sessions: sessionService.listSessions() }),
    listMessages: (sessionId) => ({
      messages: sessionService.listMessagesBySession(sessionId) as SessionMessageListData['messages'],
    }),
    listTimeline: (payload) => sessionService.listTimelineMessagesBySession(payload),
    listRuns: (sessionId) => ({ runs: sessionService.listRunsBySession(sessionId) }),
  };
}
