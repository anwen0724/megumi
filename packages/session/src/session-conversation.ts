/* Builds recoverable Session conversation facts from the active Entry Graph. */
import type { SessionMessageAttachment } from './session-attachment';
import {
  buildActiveConversationPath,
  type SessionEntry,
} from './session-entry-graph';
import type { SessionCompactionRecord } from './session-compaction';
import type { SessionMessage, SessionMessageWithAttachments } from './session-message';
import { sessionFailure, type SessionFailure } from './session';
import type { SessionStore } from './session-store';

export type SessionConversationItem =
  | SessionMessageConversationItem
  | SessionCompactionConversationItem
  | SessionBranchConversationItem;

export interface SessionMessageConversationItem {
  readonly type: 'message';
  readonly entryId: string;
  readonly parentEntryId?: string;
  readonly message: SessionMessage;
  readonly attachments: readonly SessionMessageAttachment[];
}

export interface SessionCompactionConversationItem extends SessionCompactionRecord {
  readonly type: 'compaction';
}

export interface SessionBranchConversationItem {
  readonly type: 'branch';
  readonly branchId: string;
  readonly sourceEntryId: string;
  readonly sourceMessageId: string;
  readonly targetEntryId: string;
  readonly targetMessageId: string;
  readonly createdAt: string;
}

export interface GetActiveConversationHistoryRequest {
  readonly session_id: string;
}

export type GetActiveConversationHistoryResult =
  | { readonly status: 'ok'; readonly conversation: readonly SessionConversationItem[] }
  | { readonly status: 'failed'; readonly failure: SessionFailure };

export interface GetCommittedBranchRequest {
  readonly sessionId: string;
  readonly targetEntryId: string;
}

export type GetCommittedBranchResult =
  | { readonly status: 'found'; readonly branch: SessionBranchConversationItem }
  | { readonly status: 'not_found'; readonly targetEntryId: string }
  | { readonly status: 'failed'; readonly failure: SessionFailure };

export interface GetCommittedRunMessagesRequest {
  readonly sessionId: string;
  readonly runId: string;
}

export type GetCommittedRunMessagesResult =
  | { readonly status: 'ok'; readonly messages: readonly SessionMessageConversationItem[] }
  | { readonly status: 'failed'; readonly failure: SessionFailure };

export interface SessionConversationReader {
  /** Returns visible facts on the current committed branch in deterministic order. */
  getActiveHistory(
    request: GetActiveConversationHistoryRequest,
  ): GetActiveConversationHistoryResult;
  /** Resolves one committed Branch using the same Entry Graph rule as full history. */
  getCommittedBranch(request: GetCommittedBranchRequest): GetCommittedBranchResult;
  /** Reads one Run from the same active committed conversation used by full recovery. */
  getCommittedRunMessages(request: GetCommittedRunMessagesRequest): GetCommittedRunMessagesResult;
}

/** Creates the reader that owns Entry Graph to conversation ordering rules. */
export function createSessionConversationReader(input: {
  readonly store: SessionStore;
}): SessionConversationReader {
  return {
    getActiveHistory(request) {
      try {
        return buildConversation(input.store, request.session_id);
      } catch (error) {
        return sessionFailure(error);
      }
    },
    getCommittedBranch(request) {
      try {
        const session = input.store.findSessionById(request.sessionId);
        if (!session) {
          return {
            status: 'failed',
            failure: {
              code: 'session_not_found',
              message: `Session ${request.sessionId} was not found.`,
            },
          };
        }
        const entries = input.store.listEntriesBySessionId(request.sessionId);
        const target = entries.find((entry) => entry.entry_id === request.targetEntryId);
        const branch = target ? branchForTarget(target, entries) : undefined;
        return branch
          ? { status: 'found', branch }
          : { status: 'not_found', targetEntryId: request.targetEntryId };
      } catch (error) {
        return sessionFailure(error);
      }
    },
    getCommittedRunMessages(request) {
      try {
        const result = buildConversation(input.store, request.sessionId);
        if (result.status === 'failed') return result;
        return {
          status: 'ok',
          messages: result.conversation.filter((item): item is SessionMessageConversationItem => (
            item.type === 'message' && item.message.run_id === request.runId
          )),
        };
      } catch (error) {
        return sessionFailure(error);
      }
    },
  };
}

function buildConversation(
  store: SessionStore,
  sessionId: string,
): GetActiveConversationHistoryResult {
  const session = store.findSessionById(sessionId);
  if (!session) {
    return {
      status: 'failed',
      failure: { code: 'session_not_found', message: `Session ${sessionId} was not found.` },
    };
  }

  const entries = store.listEntriesBySessionId(sessionId);
  const compactions = store.listCompactionsBySessionId(sessionId);
  const completedSummaries = compactions.flatMap((record) => (
    record.status === 'completed' && record.summary ? [record.summary] : []
  ));
  const activeEntries = buildActiveConversationPath({
    session_id: sessionId,
    active_entry_id: session.active_entry_id,
    entries,
    compactions: completedSummaries,
  });
  const activeEntryIds = new Set(activeEntries.map((entry) => entry.entry_id));
  const messageEntries = activeEntries.filter((entry) => entry.entry_type === 'message');
  const messages = store.listMessagesByIds(messageEntries.flatMap((entry) => (
    entry.message_id ? [entry.message_id] : []
  )));
  const messagesById = new Map(messages.map((message) => [message.message_id, message]));
  const attachments = groupAttachments(store.listAttachmentsByMessageIds([...messagesById.keys()]));
  const compactionsByAnchor = groupCompactions(
    compactions.filter((record) => activeEntryIds.has(record.anchorEntryId)),
    messageEntries,
  );
  const conversation: SessionConversationItem[] = [];

  for (const entry of messageEntries) {
    const branch = branchForTarget(entry, entries);
    if (branch) conversation.push(branch);
    const message = entry.message_id ? messagesById.get(entry.message_id) : undefined;
    if (message) conversation.push(messageItem(entry, message, attachments));
    for (const compaction of compactionsByAnchor.get(entry.entry_id) ?? []) {
      conversation.push({ type: 'compaction', ...compaction });
    }
  }

  return { status: 'ok', conversation };
}

function branchForTarget(
  target: SessionEntry,
  entries: readonly SessionEntry[],
): SessionBranchConversationItem | undefined {
  if (target.entry_type !== 'message' || !target.message_id || !target.parent_entry_id) {
    return undefined;
  }
  const source = entries.find((entry) => entry.entry_id === target.parent_entry_id);
  if (!source?.message_id) return undefined;
  const targetIndex = entries.findIndex((entry) => entry.entry_id === target.entry_id);
  const hasEarlierSibling = entries.some((entry, index) => (
    index < targetIndex
    && entry.entry_id !== target.entry_id
    && entry.parent_entry_id === target.parent_entry_id
  ));
  if (!hasEarlierSibling) return undefined;
  return {
    type: 'branch',
    branchId: target.entry_id,
    sourceEntryId: source.entry_id,
    sourceMessageId: source.message_id,
    targetEntryId: target.entry_id,
    targetMessageId: target.message_id,
    createdAt: target.created_at,
  };
}

function messageItem(
  entry: SessionEntry,
  message: SessionMessage,
  attachments: ReadonlyMap<string, readonly SessionMessageAttachment[]>,
): SessionMessageConversationItem {
  return {
    type: 'message',
    entryId: entry.entry_id,
    ...(entry.parent_entry_id ? { parentEntryId: entry.parent_entry_id } : {}),
    message,
    attachments: attachments.get(message.message_id) ?? [],
  };
}

function groupAttachments(
  attachments: readonly SessionMessageAttachment[],
): Map<string, readonly SessionMessageAttachment[]> {
  const grouped = new Map<string, SessionMessageAttachment[]>();
  for (const attachment of attachments) {
    const values = grouped.get(attachment.message_id) ?? [];
    values.push(attachment);
    grouped.set(attachment.message_id, values);
  }
  return grouped;
}

function groupCompactions(
  records: readonly SessionCompactionRecord[],
  messageEntries: readonly SessionEntry[],
): Map<string, readonly SessionCompactionRecord[]> {
  const grouped = new Map<string, SessionCompactionRecord[]>();
  for (const record of records) {
    const anchorEntryId = resolveCompactionActivityAnchor(record, messageEntries);
    const values = grouped.get(anchorEntryId) ?? [];
    values.push(record);
    grouped.set(anchorEntryId, values);
  }
  for (const values of grouped.values()) {
    values.sort((left, right) => (
      left.startedAt.localeCompare(right.startedAt)
      || left.compactionId.localeCompare(right.compactionId)
    ));
  }
  return grouped;
}

/**
 * Places the activity after the last committed message that existed when it
 * started. Older records used the Summary coverage boundary as anchorEntryId;
 * the timestamp fallback keeps those already-persisted activities recoverable
 * at their actual occurrence position.
 */
function resolveCompactionActivityAnchor(
  record: SessionCompactionRecord,
  messageEntries: readonly SessionEntry[],
): string {
  let anchorEntryId = record.anchorEntryId;
  for (const entry of messageEntries) {
    if (entry.created_at.localeCompare(record.startedAt) <= 0) {
      anchorEntryId = entry.entry_id;
    }
  }
  return anchorEntryId;
}

export function conversationMessageWithAttachments(
  item: SessionMessageConversationItem,
): SessionMessageWithAttachments {
  return { message: item.message, attachments: [...item.attachments] };
}
