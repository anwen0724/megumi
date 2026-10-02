/* Defines the persistence operations required by Sessions; Application supplies the adapter. */
import type { SessionMessageAttachment } from './session-attachment';
import type { SessionCompactionRecord } from './session-compaction';
import type { SessionCompactionSummary, SessionEntry } from './session-entry-graph';
import type { SessionAssistantReplyMessage, SessionMessage, UserMessage } from './session-message';
import type { Session } from './session';

export interface SessionStore {
  runInTransaction<T>(operation: () => T): T;

  insertSession(session: Session): Session;
  updateSessionModelSelection(input: {
    session_id: string;
    model_selection: NonNullable<Session['model_selection']>;
    updated_at: string;
  }): Session | undefined;
  findSessionById(sessionId: string): Session | undefined;
  listSessionsByWorkspaceId(workspaceId: string): Session[];
  archiveSession(input: { session_id: string; archived_at: string }): Session | undefined;
  updateSessionActiveEntry(input: {
    session_id: string;
    active_entry_id?: string;
    updated_at: string;
  }): Session | undefined;

  insertMessage(message: SessionMessage): SessionMessage;
  findMessageById(messageId: string): SessionMessage | undefined;
  listMessagesBySessionId(sessionId: string): SessionMessage[];
  findAssistantReplyBySessionIdAndExecutionId(input: {
    session_id: string;
    execution_id: string;
  }): SessionAssistantReplyMessage | undefined;
  listUserMessagesByExecutionIds(executionIds: string[]): UserMessage[];
  listMessagesByIds(messageIds: string[]): SessionMessage[];

  insertMessageAttachments(attachments: SessionMessageAttachment[]): void;
  findAttachmentById(attachmentId: string): SessionMessageAttachment | undefined;
  listAttachmentsByMessageIds(messageIds: string[]): SessionMessageAttachment[];

  insertEntry(entry: SessionEntry): SessionEntry;
  findEntryById(entryId: string): SessionEntry | undefined;
  findMessageEntryBySessionIdAndMessageId(input: {
    session_id: string;
    message_id: string;
  }): SessionEntry | undefined;
  listEntriesBySessionId(sessionId: string): SessionEntry[];
  updateEntryParent(input: {
    entry_id: string;
    parent_entry_id?: string;
  }): SessionEntry | undefined;

  insertCompaction(compaction: SessionCompactionRecord): SessionCompactionRecord;
  updateCompaction(compaction: SessionCompactionRecord): SessionCompactionRecord | undefined;
  findCompactionById(compactionId: string): SessionCompactionRecord | undefined;
  listCompactionsBySessionId(sessionId: string): SessionCompactionRecord[];
  listRunningCompactions(): SessionCompactionRecord[];
  listCompletedCompactionSummariesByIds(compactionIds: string[]): SessionCompactionSummary[];
}
