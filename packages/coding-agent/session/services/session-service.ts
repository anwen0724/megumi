/*
 * Implements the public Session Service. The service owns session business
 * actions and delegates SQL to the SessionRepository.
 */
import crypto from 'node:crypto';
import type {
  AppendSessionEntryRequest,
  AppendSessionEntryResult,
  ArchiveSessionRequest,
  ArchiveSessionResult,
  CreateSessionRequest,
  CreateSessionResult,
  GetActiveHistoryRequest,
  GetActiveHistoryResult,
  GetActivePathRequest,
  GetActivePathResult,
  GetSessionRequest,
  GetSessionResult,
  ListMessagesRequest,
  ListMessagesResult,
  ListSessionsRequest,
  ListSessionsResult,
  SaveAssistantMessageRequest,
  SaveAssistantMessageResult,
  SaveCompactionSummaryRequest,
  SaveCompactionSummaryResult,
  SaveUserMessageRequest,
  SaveUserMessageResult,
  SessionEntry,
  SessionHistoryItem,
  SessionMessageAttachment,
  SessionMessageWithAttachments,
  SessionService,
  SwitchActiveEntryRequest,
  SwitchActiveEntryResult,
} from '../contracts/session-contracts';
import { buildActivePath, validateSessionEntry } from '../core/session-path';
import type { SessionRepository } from '../repositories/session-repository';

export type CreateSessionServiceOptions = {
  repository: SessionRepository;
  ids?: {
    sessionId?: () => string;
    entryId(input: { kind: 'message' | 'compaction'; source_id: string }): string;
  };
  now?: () => string;
};

export function createSessionService(options: CreateSessionServiceOptions): SessionService {
  return new DefaultSessionService(options);
}

class DefaultSessionService implements SessionService {
  constructor(private readonly options: CreateSessionServiceOptions) {}

  createSession(request: CreateSessionRequest): CreateSessionResult {
    try {
      const createdAt = this.now();
      const session = this.options.repository.insertSession({
        session_id: this.sessionId(),
        workspace_id: request.workspace_id,
        title: request.title?.trim() || 'New session',
        status: 'active',
        active_entry_id: undefined,
        created_at: createdAt,
        updated_at: createdAt,
      });
      return { status: 'created', session };
    } catch (error) {
      return failed(error);
    }
  }

  getSession(request: GetSessionRequest): GetSessionResult {
    try {
      const session = this.options.repository.findSessionById(request.session_id);
      return session ? { status: 'found', session } : { status: 'not_found' };
    } catch (error) {
      return failed(error);
    }
  }

  listSessions(request: ListSessionsRequest): ListSessionsResult {
    try {
      return { status: 'ok', sessions: this.options.repository.listSessionsByWorkspaceId(request.workspace_id) };
    } catch (error) {
      return failed(error);
    }
  }

  archiveSession(request: ArchiveSessionRequest): ArchiveSessionResult {
    try {
      const session = this.options.repository.updateSessionArchiveState(request);
      return session ? { status: 'archived', session } : { status: 'not_found' };
    } catch (error) {
      return failed(error);
    }
  }

  saveUserMessage(request: SaveUserMessageRequest): SaveUserMessageResult {
    try {
      return this.options.repository.runInTransaction<SaveUserMessageResult>(() => {
        const session = this.options.repository.findSessionById(request.session_id);
        if (!session) {
          return {
            status: 'failed',
            failure: { code: 'session_not_found', message: `Session ${request.session_id} was not found` },
          };
        }
        const parentEntryId = this.resolveParentEntryId({
          session_id: request.session_id,
          explicit_parent_entry_id: request.parent_entry_id,
          active_entry_id: session.active_entry_id,
        });
        if (parentEntryId.status === 'failed') {
          return parentEntryId;
        }
        const message = this.options.repository.insertMessage({
          message_id: request.message_id,
          session_id: request.session_id,
          ...(request.run_id ? { run_id: request.run_id } : {}),
          role: 'user',
          content_text: request.content_text,
          created_at: request.created_at,
          completed_at: request.created_at,
        });
        const attachments = toSavedAttachments(request);
        this.options.repository.insertMessageAttachments(attachments);
        const persistedAttachments = this.options.repository.listAttachmentsByMessageIds([message.message_id]);
        const entry = this.options.repository.insertEntry({
          entry_id: this.entryId({ kind: 'message', source_id: request.message_id }),
          session_id: request.session_id,
          parent_entry_id: parentEntryId.parent_entry_id,
          entry_type: 'message',
          message_id: request.message_id,
          created_at: request.created_at,
        });
        this.options.repository.updateActiveEntry({
          session_id: request.session_id,
          active_entry_id: entry.entry_id,
          updated_at: request.created_at,
        });
        return {
          status: 'saved',
          message: { message, attachments: persistedAttachments },
          entry,
        };
      });
    } catch (error) {
      return failed(error);
    }
  }

  saveAssistantMessage(request: SaveAssistantMessageRequest): SaveAssistantMessageResult {
    try {
      return this.options.repository.runInTransaction<SaveAssistantMessageResult>(() => {
        const session = this.options.repository.findSessionById(request.session_id);
        if (!session) {
          return {
            status: 'failed',
            failure: { code: 'session_not_found', message: `Session ${request.session_id} was not found` },
          };
        }
        const message = this.options.repository.insertMessage({
          message_id: request.message_id,
          session_id: request.session_id,
          run_id: request.run_id,
          role: 'assistant',
          content_text: request.content_text,
          created_at: request.completed_at,
          completed_at: request.completed_at,
        });
        const entry = this.options.repository.insertEntry({
          entry_id: this.entryId({ kind: 'message', source_id: request.message_id }),
          session_id: request.session_id,
          parent_entry_id: session.active_entry_id,
          entry_type: 'message',
          message_id: request.message_id,
          created_at: request.completed_at,
        });
        this.options.repository.updateActiveEntry({
          session_id: request.session_id,
          active_entry_id: entry.entry_id,
          updated_at: request.completed_at,
        });
        return { status: 'saved', message, entry };
      });
    } catch (error) {
      return failed(error);
    }
  }

  listMessages(request: ListMessagesRequest): ListMessagesResult {
    try {
      const messages = request.active_path_only
        ? this.messagesForActivePath(request.session_id)
        : { status: 'ok' as const, messages: this.options.repository.listMessagesBySessionId(request.session_id) };
      if (messages.status === 'failed') {
        return messages;
      }
      return { status: 'ok', messages: this.attachmentsForMessages(messages.messages) };
    } catch (error) {
      return failed(error);
    }
  }

  getActivePath(request: GetActivePathRequest): GetActivePathResult {
    try {
      return this.activePath(request.session_id);
    } catch (error) {
      return failed(error);
    }
  }

  getActiveHistory(request: GetActiveHistoryRequest): GetActiveHistoryResult {
    try {
      const activePath = this.activePath(request.session_id, request.through_entry_id);
      if (activePath.status === 'failed') {
        return activePath;
      }
      const path = activePath.entries;
      const messages = this.options.repository.listMessagesByIds(path.flatMap((entry) => entry.message_id ? [entry.message_id] : []));
      const messagesById = new Map(messages.map((message) => [message.message_id, message]));
      const attachmentsByMessageId = groupAttachments(this.options.repository.listAttachmentsByMessageIds([...messagesById.keys()]));
      const compactions = this.options.repository.listCompactionSummariesByIds(path.flatMap((entry) => entry.compaction_id ? [entry.compaction_id] : []));
      const compactionsById = new Map(compactions.map((compaction) => [compaction.compaction_id, compaction]));
      const history: SessionHistoryItem[] = [];
      for (const entry of path) {
        if (entry.entry_type === 'message' && entry.message_id) {
          const message = messagesById.get(entry.message_id);
          if (message) {
            history.push({ type: 'message', entry, message, attachments: attachmentsByMessageId.get(message.message_id) ?? [] });
          }
          continue;
        }
        if (entry.entry_type === 'compaction' && entry.compaction_id) {
          const compaction = compactionsById.get(entry.compaction_id);
          if (compaction) {
            history.push({ type: 'compaction', entry, compaction });
          }
        }
      }
      return { status: 'ok', history };
    } catch (error) {
      return failed(error);
    }
  }

  appendSessionEntry(request: AppendSessionEntryRequest): AppendSessionEntryResult {
    try {
      const validation = validateSessionEntry(request);
      if (validation.status === 'failed') {
        return { status: 'failed', failure: { code: 'invalid_session_entry', message: validation.message } };
      }
      if (request.parent_entry_id) {
        const parent = this.options.repository.findEntryById(request.parent_entry_id);
        if (!parent || parent.session_id !== request.session_id) {
          return {
            status: 'failed',
            failure: { code: 'invalid_parent_entry', message: 'parent_entry_id must belong to the same session' },
          };
        }
      }
      return { status: 'appended', entry: this.options.repository.insertEntry(request) };
    } catch (error) {
      return failed(error);
    }
  }

  switchActiveEntry(request: SwitchActiveEntryRequest): SwitchActiveEntryResult {
    try {
      if (request.active_entry_id) {
        const entry = this.options.repository.findEntryById(request.active_entry_id);
        if (!entry || entry.session_id !== request.session_id) {
          return { status: 'failed', failure: { code: 'invalid_active_entry', message: 'active_entry_id must belong to the session' } };
        }
      }
      const session = this.options.repository.updateActiveEntry(request);
      return session
        ? { status: 'updated', session }
        : { status: 'failed', failure: { code: 'session_not_found', message: `Session ${request.session_id} was not found` } };
    } catch (error) {
      return failed(error);
    }
  }

  saveCompactionSummary(request: SaveCompactionSummaryRequest): SaveCompactionSummaryResult {
    try {
      return this.options.repository.runInTransaction<SaveCompactionSummaryResult>(() => {
        const session = this.options.repository.findSessionById(request.session_id);
        if (!session) {
          return {
            status: 'failed',
            failure: { code: 'session_not_found', message: `Session ${request.session_id} was not found` },
          };
        }
        if (
          Object.prototype.hasOwnProperty.call(request, 'expected_active_entry_id')
          && session.active_entry_id !== (request.expected_active_entry_id ?? undefined)
        ) {
          return {
            status: 'failed',
            failure: { code: 'active_entry_changed', message: 'Session active entry changed while compaction was being prepared' },
          };
        }
        const coveredEntry = this.options.repository.findEntryById(request.covered_until_entry_id);
        if (!coveredEntry || coveredEntry.session_id !== request.session_id) {
          return {
            status: 'failed',
            failure: { code: 'invalid_covered_until_entry', message: 'covered_until_entry_id must belong to the session' },
          };
        }
        const firstKeptEntry = request.first_kept_entry_id
          ? this.options.repository.findEntryById(request.first_kept_entry_id)
          : undefined;
        if (request.first_kept_entry_id && (!firstKeptEntry || firstKeptEntry.session_id !== request.session_id)) {
          return {
            status: 'failed',
            failure: { code: 'invalid_first_kept_entry', message: 'first_kept_entry_id must belong to the session' },
          };
        }
        const compaction = this.options.repository.insertCompactionSummary({
          compaction_id: request.compaction_id,
          session_id: request.session_id,
          summary_text: request.summary_text,
          covered_until_entry_id: request.covered_until_entry_id,
          ...(request.first_kept_entry_id ? { first_kept_entry_id: request.first_kept_entry_id } : {}),
          created_at: request.created_at,
        });
        if (!request.append_to_active_path) {
          return { status: 'saved', compaction };
        }
        const entry = this.options.repository.insertEntry({
          entry_id: this.entryId({ kind: 'compaction', source_id: request.compaction_id }),
          session_id: request.session_id,
          parent_entry_id: request.first_kept_entry_id ? undefined : session.active_entry_id,
          entry_type: 'compaction',
          compaction_id: request.compaction_id,
          created_at: request.created_at,
        });
        if (request.first_kept_entry_id) {
          this.options.repository.updateEntryParent({
            entry_id: request.first_kept_entry_id,
            parent_entry_id: entry.entry_id,
          });
        }
        if (!session.active_entry_id || session.active_entry_id === request.covered_until_entry_id) {
          this.options.repository.updateActiveEntry({
            session_id: request.session_id,
            active_entry_id: entry.entry_id,
            updated_at: request.created_at,
          });
        }
        if (!request.first_kept_entry_id && session.active_entry_id !== request.covered_until_entry_id) {
          this.options.repository.updateActiveEntry({
            session_id: request.session_id,
            active_entry_id: entry.entry_id,
            updated_at: request.created_at,
          });
        }
        return { status: 'saved', compaction, entry };
      });
    } catch (error) {
      return failed(error);
    }
  }

  private activePath(sessionId: string, throughEntryId?: string | null): GetActivePathResult {
    const session = this.options.repository.findSessionById(sessionId);
    if (!session) {
      return {
        status: 'failed',
        failure: { code: 'session_not_found', message: `Session ${sessionId} was not found` },
      };
    }
    if (throughEntryId === null) {
      return { status: 'ok', entries: [] };
    }
    if (throughEntryId !== undefined) {
      const throughEntry = this.options.repository.findEntryById(throughEntryId);
      if (!throughEntry || throughEntry.session_id !== sessionId) {
        return {
          status: 'failed',
          failure: {
            code: 'invalid_through_entry',
            message: 'through_entry_id must belong to the session',
          },
        };
      }
    }
    return {
      status: 'ok',
      entries: buildActivePath({
        session_id: sessionId,
        active_entry_id: throughEntryId ?? session.active_entry_id,
        entries: this.options.repository.listEntriesBySessionId(sessionId),
      }),
    };
  }

  private messagesForActivePath(sessionId: string): { status: 'ok'; messages: ReturnType<SessionRepository['listMessagesByIds']> } | Extract<ListMessagesResult, { status: 'failed' }> {
    const activePath = this.activePath(sessionId);
    if (activePath.status === 'failed') {
      return activePath;
    }
    const messageIds = activePath.entries.flatMap((entry) => (
      entry.entry_type === 'message' && entry.message_id ? [entry.message_id] : []
    ));
    const messagesById = new Map(
      this.options.repository.listMessagesByIds(messageIds).map((message) => [message.message_id, message]),
    );
    return { status: 'ok', messages: messageIds.flatMap((messageId) => {
      const message = messagesById.get(messageId);
      return message ? [message] : [];
    }) };
  }

  private attachmentsForMessages(messages: ReturnType<SessionRepository['listMessagesByIds']>): SessionMessageWithAttachments[] {
    const attachmentsByMessageId = groupAttachments(this.options.repository.listAttachmentsByMessageIds(messages.map((message) => message.message_id)));
    return messages.map((message) => ({
      message,
      attachments: attachmentsByMessageId.get(message.message_id) ?? [],
    }));
  }

  private entryId(input: { kind: 'message' | 'compaction'; source_id: string }): string {
    return this.options.ids?.entryId(input) ?? `${input.kind}:${input.source_id}`;
  }

  private sessionId(): string {
    return this.options.ids?.sessionId?.() ?? `session:${crypto.randomUUID()}`;
  }

  private resolveParentEntryId(input: {
    session_id: string;
    explicit_parent_entry_id?: string;
    active_entry_id?: string;
  }): { status: 'ok'; parent_entry_id?: string } | Extract<SaveUserMessageResult, { status: 'failed' }> {
    const parentEntryId = input.explicit_parent_entry_id ?? input.active_entry_id;
    if (!input.explicit_parent_entry_id) {
      return { status: 'ok', ...(parentEntryId ? { parent_entry_id: parentEntryId } : {}) };
    }
    const parent = this.options.repository.findEntryById(input.explicit_parent_entry_id);
    if (!parent || parent.session_id !== input.session_id) {
      return {
        status: 'failed',
        failure: { code: 'invalid_parent_entry', message: 'parent_entry_id must belong to the same session' },
      };
    }
    return { status: 'ok', parent_entry_id: parentEntryId };
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }
}

function toSavedAttachments(request: SaveUserMessageRequest): SessionMessageAttachment[] {
  return (request.attachments ?? []).map((attachment) => ({
    attachment_id: attachment.attachment_id,
    message_id: request.message_id,
    session_id: request.session_id,
    type: attachment.type,
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mime_type ? { mime_type: attachment.mime_type } : {}),
    source_type: attachment.source.type,
    source_value: attachment.source.type === 'local_file' ? attachment.source.path : attachment.source.reference_id,
    created_at: request.created_at,
  }));
}

function groupAttachments(attachments: SessionMessageAttachment[]): Map<string, SessionMessageAttachment[]> {
  const grouped = new Map<string, SessionMessageAttachment[]>();
  for (const attachment of attachments) {
    const existing = grouped.get(attachment.message_id) ?? [];
    existing.push(attachment);
    grouped.set(attachment.message_id, existing);
  }
  return grouped;
}

function failed(error: unknown): { status: 'failed'; failure: { code: string; message: string } } {
  return {
    status: 'failed',
    failure: {
      code: 'session_error',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
