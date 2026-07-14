/* Defines the single public Session owner capability. */
import type { Session, SessionRuntimeError } from '../domain/model/session';
import type { SessionEntry } from '../domain/model/session-entry';
import type { SessionMessage, SessionMessageWithAttachments } from '../domain/model/session-message';
import type {
  SaveAssistantMessageRequest,
  SaveToolResultMessageRequest,
  SaveUserMessageRequest,
} from '../domain/dto/agent-run/session-agent-run-request';
import type {
  SaveAssistantMessageResult,
  SaveToolResultMessageResult,
  SaveUserMessageResult,
} from '../domain/dto/agent-run/session-agent-run-response';
import type {
  GetActiveHistoryRequest,
  SaveCompactionSummaryRequest,
} from '../domain/dto/context/session-context-request';
import type {
  GetActiveHistoryResult,
  SaveCompactionSummaryResult,
} from '../domain/dto/context/session-context-response';

export type CreateSessionRequest = { workspace_id: string; title?: string };
export type CreateSessionResult = { status: 'created'; session: Session } | { status: 'failed'; failure: SessionRuntimeError };
export type GetSessionRequest = { session_id: string };
export type GetSessionResult = { status: 'found'; session: Session } | { status: 'not_found' } | { status: 'failed'; failure: SessionRuntimeError };
export type ListSessionsRequest = { workspace_id: string };
export type ListSessionsResult = { status: 'ok'; sessions: Session[] } | { status: 'failed'; failure: SessionRuntimeError };
export type ArchiveSessionRequest = { session_id: string; archived_at: string };
export type ArchiveSessionResult = { status: 'archived'; session: Session } | { status: 'not_found' } | { status: 'failed'; failure: SessionRuntimeError };
export type ListMessagesRequest = { session_id: string; active_path_only?: boolean };
export type ListMessagesResult = { status: 'ok'; messages: SessionMessageWithAttachments[] } | { status: 'failed'; failure: SessionRuntimeError };
export type ListUserMessagesByRunIdsRequest = { run_ids: string[] };
export type ListUserMessagesByRunIdsResult = { status: 'ok'; messages: SessionMessage[] } | { status: 'failed'; failure: SessionRuntimeError };
export type GetActivePathRequest = { session_id: string };
export type GetActivePathResult = { status: 'ok'; entries: SessionEntry[] } | { status: 'failed'; failure: SessionRuntimeError };
export type GetActiveConversationHistoryRequest = { session_id: string; run_id?: string };
export type GetActiveConversationHistoryResult = { status: 'ok'; messages: SessionMessageWithAttachments[] } | { status: 'failed'; failure: SessionRuntimeError };
export type AppendSessionEntryRequest = SessionEntry;
export type AppendSessionEntryResult = { status: 'appended'; entry: SessionEntry } | { status: 'failed'; failure: SessionRuntimeError };
export type SwitchActiveEntryRequest = { session_id: string; active_entry_id?: string; updated_at: string };
export type SwitchActiveEntryResult = { status: 'updated'; session: Session } | { status: 'failed'; failure: SessionRuntimeError };

export type SessionService = {
  createSession(request: CreateSessionRequest): CreateSessionResult;
  getSession(request: GetSessionRequest): GetSessionResult;
  listSessions(request: ListSessionsRequest): ListSessionsResult;
  archiveSession(request: ArchiveSessionRequest): ArchiveSessionResult;
  saveUserMessage(request: SaveUserMessageRequest): SaveUserMessageResult;
  saveAssistantMessage(request: SaveAssistantMessageRequest): SaveAssistantMessageResult;
  saveToolResultMessage(request: SaveToolResultMessageRequest): SaveToolResultMessageResult;
  listMessages(request: ListMessagesRequest): ListMessagesResult;
  listUserMessagesByRunIds(request: ListUserMessagesByRunIdsRequest): ListUserMessagesByRunIdsResult;
  getActivePath(request: GetActivePathRequest): GetActivePathResult;
  getActiveHistory(request: GetActiveHistoryRequest): GetActiveHistoryResult;
  getActiveConversationHistory(request: GetActiveConversationHistoryRequest): GetActiveConversationHistoryResult;
  appendSessionEntry(request: AppendSessionEntryRequest): AppendSessionEntryResult;
  switchActiveEntry(request: SwitchActiveEntryRequest): SwitchActiveEntryResult;
  saveCompactionSummary(request: SaveCompactionSummaryRequest): SaveCompactionSummaryResult;
};

export type {
  SaveAssistantMessageRequest,
  SaveToolResultMessageRequest,
  SaveUserMessageRequest,
  SaveAssistantMessageResult,
  SaveToolResultMessageResult,
  SaveUserMessageResult,
  GetActiveHistoryRequest,
  SaveCompactionSummaryRequest,
  GetActiveHistoryResult,
  SaveCompactionSummaryResult,
};
