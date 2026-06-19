// Provides a focused in-memory session repository for desktop adapter tests.
import type {
  BranchMarker,
  RetryAttempt,
  Session,
  SessionMessage,
  SessionRunRecord,
  SessionSourceEntry,
  SessionStateRepository,
} from '../../../../src/session';

export function createInMemorySessionRepository(): SessionStateRepository {
  const sessions = new Map<string, Session>();
  const messages = new Map<string, SessionMessage>();
  const entries = new Map<string, SessionSourceEntry>();
  const activeLeaves = new Map<string, string>();
  const branches = new Map<string, BranchMarker>();
  const retries = new Map<string, RetryAttempt>();
  const runs = new Map<string, SessionRunRecord>();

  return {
    transaction: (work) => work(),
    createSession(session) {
      sessions.set(session.id, session);
      return session;
    },
    getSession: (sessionId) => sessions.get(String(sessionId)),
    listSessions: () => [...sessions.values()],
    insertMessage(message) {
      messages.set(message.id, message);
      return message;
    },
    getMessage: (messageId) => messages.get(String(messageId)),
    listMessagesForSession: (sessionId) => [...messages.values()].filter((message) => message.sessionId === String(sessionId)),
    getMessagesForPath(path) {
      return path.flatMap((entry) => entry.kind === 'message' && entry.ref.type === 'message'
        ? [messages.get(String(entry.ref.messageId))].filter(Boolean) as SessionMessage[]
        : []);
    },
    insertSourceEntry(entry) {
      entries.set(entry.id, entry);
      return entry;
    },
    getSourceEntry: (sourceEntryId) => entries.get(String(sourceEntryId)),
    getActiveLeaf(sessionId) {
      const id = activeLeaves.get(String(sessionId));
      return id ? entries.get(id) : undefined;
    },
    setActiveLeaf(sessionId, sourceEntryId) {
      activeLeaves.set(String(sessionId), String(sourceEntryId));
    },
    getActivePath(sessionId) {
      const activeLeafId = activeLeaves.get(String(sessionId));
      const leaf = activeLeafId ? entries.get(activeLeafId) : undefined;
      const path: SessionSourceEntry[] = [];
      let current = leaf;
      while (current) {
        path.push(current);
        current = current.parentId ? entries.get(current.parentId) : undefined;
      }
      return path.reverse();
    },
    insertBranchMarker(marker) {
      branches.set(marker.id, marker);
      return marker;
    },
    listBranchMarkers: (sessionId) => [...branches.values()].filter((marker) => marker.sessionId === String(sessionId)),
    insertRetryAttempt(attempt) {
      retries.set(attempt.id, attempt);
      return attempt;
    },
    listRetryAttempts: (sessionId) => [...retries.values()].filter((attempt) => attempt.sessionId === String(sessionId)),
    insertRunRecord(run) {
      runs.set(run.id, run);
      return run;
    },
    updateRunRecord(run) {
      runs.set(run.id, run);
      return run;
    },
    getRunRecord: (runId) => runs.get(String(runId)),
    listRunRecords: (sessionId) => [...runs.values()].filter((run) => run.sessionId === String(sessionId)),
  };
}
