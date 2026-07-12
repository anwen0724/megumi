/*
 * Defines the public Session module contracts. These contracts represent
 * session-owned business facts and the Session Service API.
 */

type RuntimeError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type Session = {
  session_id: string;
  workspace_id: string;
  title: string;
  status: 'active' | 'archived';
  active_entry_id?: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
};

export type SessionMessage = {
  message_id: string;
  session_id: string;
  run_id?: string;
  role: 'user' | 'assistant';
  content_text: string;
  created_at: string;
  completed_at?: string;
};

export type SessionMessageAttachment = {
  attachment_id: string;
  message_id: string;
  session_id: string;
  type: 'image' | 'file';
  name?: string;
  mime_type?: string;
  source_type: 'local_file' | 'host_reference';
  source_value: string;
  created_at: string;
};

export type SessionMessageAttachmentInput = {
  attachment_id: string;
  type: 'image' | 'file';
  name?: string;
  mime_type?: string;
  source:
    | { type: 'local_file'; path: string }
    | { type: 'host_reference'; reference_id: string };
};

export type SessionEntry = {
  entry_id: string;
  session_id: string;
  parent_entry_id?: string;
  entry_type: 'message' | 'compaction';
  message_id?: string;
  compaction_id?: string;
  created_at: string;
};

export type SessionCompactionSummary = {
  compaction_id: string;
  session_id: string;
  summary_text: string;
  covered_until_entry_id: string;
  first_kept_entry_id?: string;
  created_at: string;
};

export type SessionMessageWithAttachments = {
  message: SessionMessage;
  attachments: SessionMessageAttachment[];
};

export type SessionHistoryItem =
  | {
      type: 'message';
      entry: SessionEntry;
      message: SessionMessage;
      attachments: SessionMessageAttachment[];
    }
  | {
      type: 'compaction';
      entry: SessionEntry;
      compaction: SessionCompactionSummary;
    };

export type CreateSessionRequest = {
  workspace_id: string;
  title?: string;
};

export type CreateSessionResult =
  | { status: 'created'; session: Session }
  | { status: 'failed'; failure: RuntimeError };

export type GetSessionRequest = {
  session_id: string;
};

export type GetSessionResult =
  | { status: 'found'; session: Session }
  | { status: 'not_found' }
  | { status: 'failed'; failure: RuntimeError };

export type ListSessionsRequest = {
  workspace_id: string;
};

export type ListSessionsResult =
  | { status: 'ok'; sessions: Session[] }
  | { status: 'failed'; failure: RuntimeError };

export type ArchiveSessionRequest = {
  session_id: string;
  archived_at: string;
};

export type ArchiveSessionResult =
  | { status: 'archived'; session: Session }
  | { status: 'not_found' }
  | { status: 'failed'; failure: RuntimeError };

export type SaveUserMessageRequest = {
  message_id: string;
  session_id: string;
  run_id?: string;
  content_text: string;
  attachments?: SessionMessageAttachmentInput[];
  parent_entry_id?: string;
  created_at: string;
};

export type SaveUserMessageResult =
  | { status: 'saved'; message: SessionMessageWithAttachments; entry: SessionEntry }
  | { status: 'failed'; failure: RuntimeError };

export type SaveAssistantMessageRequest = {
  message_id: string;
  session_id: string;
  run_id: string;
  content_text: string;
  completed_at: string;
};

export type SaveAssistantMessageResult =
  | { status: 'saved'; message: SessionMessage; entry: SessionEntry }
  | { status: 'failed'; failure: RuntimeError };

export type ListMessagesRequest = {
  session_id: string;
  active_path_only?: boolean;
};

export type ListMessagesResult =
  | { status: 'ok'; messages: SessionMessageWithAttachments[] }
  | { status: 'failed'; failure: RuntimeError };

export type GetActivePathRequest = {
  session_id: string;
};

export type GetActivePathResult =
  | { status: 'ok'; entries: SessionEntry[] }
  | { status: 'failed'; failure: RuntimeError };

export type GetActiveHistoryRequest = {
  session_id: string;
  through_entry_id?: string | null;
};

export type GetActiveHistoryResult =
  | { status: 'ok'; history: SessionHistoryItem[] }
  | { status: 'failed'; failure: RuntimeError };

export type AppendSessionEntryRequest = {
  entry_id: string;
  session_id: string;
  parent_entry_id?: string;
  entry_type: 'message' | 'compaction';
  message_id?: string;
  compaction_id?: string;
  created_at: string;
};

export type AppendSessionEntryResult =
  | { status: 'appended'; entry: SessionEntry }
  | { status: 'failed'; failure: RuntimeError };

export type SwitchActiveEntryRequest = {
  session_id: string;
  active_entry_id?: string;
  updated_at: string;
};

export type SwitchActiveEntryResult =
  | { status: 'updated'; session: Session }
  | { status: 'failed'; failure: RuntimeError };

export type SaveCompactionSummaryRequest = {
  compaction_id: string;
  session_id: string;
  summary_text: string;
  covered_until_entry_id: string;
  first_kept_entry_id?: string;
  expected_active_entry_id?: string | null;
  created_at: string;
  append_to_active_path?: boolean;
};

export type SaveCompactionSummaryResult =
  | { status: 'saved'; compaction: SessionCompactionSummary; entry?: SessionEntry }
  | { status: 'failed'; failure: RuntimeError };

export type SessionService = {
  createSession(request: CreateSessionRequest): CreateSessionResult;
  getSession(request: GetSessionRequest): GetSessionResult;
  listSessions(request: ListSessionsRequest): ListSessionsResult;
  archiveSession(request: ArchiveSessionRequest): ArchiveSessionResult;
  saveUserMessage(request: SaveUserMessageRequest): SaveUserMessageResult;
  saveAssistantMessage(request: SaveAssistantMessageRequest): SaveAssistantMessageResult;
  listMessages(request: ListMessagesRequest): ListMessagesResult;
  getActivePath(request: GetActivePathRequest): GetActivePathResult;
  getActiveHistory(request: GetActiveHistoryRequest): GetActiveHistoryResult;
  appendSessionEntry(request: AppendSessionEntryRequest): AppendSessionEntryResult;
  switchActiveEntry(request: SwitchActiveEntryRequest): SwitchActiveEntryResult;
  saveCompactionSummary(request: SaveCompactionSummaryRequest): SaveCompactionSummaryResult;
};
