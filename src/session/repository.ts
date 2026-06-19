// Declares the persistence port consumed by SessionStateManager; callers must use the manager for state changes.
// Low-level insert and active-leaf methods are adapter operations, not a public workflow API for other modules.
import type { BranchMarker } from './branch';
import type { RetryAttempt } from './retry';
import type { SessionRunRecord } from './run-history';
import type { Session } from './session';
import type { SessionMessage } from './message';
import type { SessionId, SessionMessageId, SessionRunId, SessionSourceEntryId } from './ids';
import type { SessionSourceEntry } from './source-entry';

export interface SessionStateRepository {
  transaction<T>(work: () => T): T;
  createSession(session: Session): Session;
  getSession(sessionId: SessionId | string): Session | undefined;
  listSessions(): Session[];
  insertMessage(message: SessionMessage): SessionMessage;
  getMessage(messageId: SessionMessageId | string): SessionMessage | undefined;
  listMessagesForSession(sessionId: SessionId | string): SessionMessage[];
  getMessagesForPath(path: SessionSourceEntry[]): SessionMessage[];
  insertSourceEntry(entry: SessionSourceEntry): SessionSourceEntry;
  getSourceEntry(sourceEntryId: SessionSourceEntryId | string): SessionSourceEntry | undefined;
  getActiveLeaf(sessionId: SessionId | string): SessionSourceEntry | undefined;
  setActiveLeaf(sessionId: SessionId | string, sourceEntryId: SessionSourceEntryId | string): void;
  getActivePath(sessionId: SessionId | string): SessionSourceEntry[];
  insertBranchMarker(marker: BranchMarker): BranchMarker;
  listBranchMarkers(sessionId: SessionId | string): BranchMarker[];
  insertRetryAttempt(attempt: RetryAttempt): RetryAttempt;
  listRetryAttempts(sessionId: SessionId | string): RetryAttempt[];
  insertRunRecord(run: SessionRunRecord): SessionRunRecord;
  updateRunRecord(run: SessionRunRecord): SessionRunRecord;
  getRunRecord(runId: SessionRunId | string): SessionRunRecord | undefined;
  listRunRecords(sessionId: SessionId | string): SessionRunRecord[];
}
