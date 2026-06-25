// Desktop facade over the product SessionRunService session methods. IPC session
// handlers depend on this facade rather than the product class directly, keeping
// the adapter boundary explicit. The facade owns the (intentional) coupling to the
// product service and exposes only the session surface the desktop UI needs.
import type { SessionRunService } from '@megumi/coding-agent/run';

export type DesktopSessionService = Pick<
  SessionRunService,
  | 'createSession'
  | 'listSessions'
  | 'listMessagesBySession'
  | 'listTimelineMessagesBySession'
  | 'sendSessionMessage'
  | 'cancelSessionMessage'
  | 'createBranchDraft'
  | 'cancelBranchDraft'
>;

export function createDesktopSessionService(runtime: SessionRunService): DesktopSessionService {
  return {
    createSession: (payload) => runtime.createSession(payload),
    listSessions: () => runtime.listSessions(),
    listMessagesBySession: (sessionId) => runtime.listMessagesBySession(sessionId),
    listTimelineMessagesBySession: (input) => runtime.listTimelineMessagesBySession(input),
    sendSessionMessage: (input) => runtime.sendSessionMessage(input),
    cancelSessionMessage: (payload) => runtime.cancelSessionMessage(payload),
    createBranchDraft: (input) => runtime.createBranchDraft(input),
    cancelBranchDraft: (input) => runtime.cancelBranchDraft(input),
  };
}
