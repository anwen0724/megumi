/* Commits and reads session messages, preserving conversation and branch semantics. */
import type { JsonValue } from '@megumi/ai';
import { z } from 'zod';
import type {
  BeginCompactionRequest,
  BeginCompactionResult,
  CompleteCompactionRequest,
  CompleteCompactionResult,
  EndCompactionRequest,
  EndCompactionResult,
  InterruptRunningCompactionsRequest,
  InterruptRunningCompactionsResult,
  SessionCompactionLifecycle,
  SessionCompactionRecord,
} from '../compact-history';
import { createSessionCompactionLifecycle } from '../compact-history';
import type {
  SessionAttachmentContentStore,
  SessionAttachmentImport,
  SessionMessageAttachment,
} from './session-attachments';
import type { SessionEntry, SessionHistoryItem } from './session-branches';
import { buildActiveConversationPath, readActivePath } from './session-branches';
import type { SessionFailure } from './session-catalog';
import { sessionFailure } from './session-catalog';
import type { SessionStore } from './session-storage';

export interface SaveUserMessageRequest {
  message_id: string;
  session_id: string;
  execution_id?: string;
  display_content: SessionUserContent[];
  model_content: SessionUserContent[];
  skill_selection?: { name: string; skill_path: string };
  attachments?: SessionAttachmentImport[];
  parent_entry_id?: string;
  created_at: string;
}

export interface SaveModelResponseRequest {
  message_id: string;
  session_id: string;
  execution_id: string;
  parent_entry_id?: string;
  content: SessionAssistantContent[];
  outcome_status: 'completed' | 'incomplete' | 'failed';
  reason_code?: string;
  stop_reason?: string;
  api?: string;
  provider?: string;
  model?: string;
  response_model?: string;
  response_id?: string;
  usage?: import('@megumi/ai').Usage;
  failure?: { code: string; message: string; retryable: boolean; retryAfterMs?: number };
  error_message?: string;
  completed_at: string;
}

export interface SaveAssistantReplyRequest {
  message_id: string;
  session_id: string;
  execution_id: string;
  parent_entry_id?: string;
  status: AssistantReplyStatus;
  content: SessionAssistantContent[];
  reason_code?: AssistantReplyReasonCode;
  api?: string;
  provider?: string;
  model?: string;
  response_model?: string;
  response_id?: string;
  usage?: import('@megumi/ai').Usage;
  error_message?: string;
  completed_at: string;
}

export interface SaveToolResultMessageRequest {
  message_id: string;
  session_id: string;
  execution_id: string;
  parent_entry_id?: string;
  tool_call_id: string;
  tool_name: string;
  status: 'success' | 'failure' | 'permission_denied' | 'user_rejected' | 'cancelled';
  error?: Extract<SessionMessage, { message_kind: 'tool_result' }>['error'];
  content: SessionUserContent[];
  /** Tool-owned usage that never counts toward the main model Context. */
  usage?: import('@megumi/ai').Usage;
  completed_at: string;
}

export type SaveUserMessageResult =
  | { status: 'saved'; message: SessionMessageWithAttachments; entry: SessionEntry }
  | { status: 'failed'; failure: SessionFailure };

export type SaveMessageResult =
  | { status: 'saved'; message: SessionMessage; entry: SessionEntry }
  | { status: 'failed'; failure: SessionFailure };

export type SaveModelResponseResult = SaveMessageResult;

export type SaveAssistantReplyResult = SaveMessageResult;

export type SaveToolResultMessageResult = SaveMessageResult;

export interface ListMessagesRequest {
  session_id: string;
  active_path_only?: boolean;
}

export type ListMessagesResult =
  | { status: 'ok'; messages: SessionMessageWithAttachments[] }
  | { status: 'failed'; failure: SessionFailure };

export interface ListUserMessagesByExecutionIdsRequest {
  execution_ids: string[];
}

export type ListUserMessagesByExecutionIdsResult =
  | { status: 'ok'; messages: UserMessage[] }
  | { status: 'failed'; failure: SessionFailure };

export interface GetActiveHistoryRequest {
  session_id: string;
  through_entry_id?: string | null;
}

export type GetActiveHistoryResult =
  | { status: 'ok'; history: SessionHistoryItem[] }
  | { status: 'failed'; failure: SessionFailure };

export interface SessionHistory {
  saveUserMessage(request: SaveUserMessageRequest): Promise<SaveUserMessageResult>;
  saveModelResponse(request: SaveModelResponseRequest): SaveModelResponseResult;
  saveAssistantReply(request: SaveAssistantReplyRequest): SaveAssistantReplyResult;
  saveToolResultMessage(request: SaveToolResultMessageRequest): SaveToolResultMessageResult;
  listMessages(request: ListMessagesRequest): ListMessagesResult;
  listUserMessagesByExecutionIds(
    request: ListUserMessagesByExecutionIdsRequest,
  ): ListUserMessagesByExecutionIdsResult;
  getActiveHistory(request: GetActiveHistoryRequest): GetActiveHistoryResult;
  getActiveConversationHistory(
    request: GetActiveConversationHistoryRequest,
  ): GetActiveConversationHistoryResult;
  getCommittedBranch(request: GetCommittedBranchRequest): GetCommittedBranchResult;
  getCommittedRunMessages(request: GetCommittedRunMessagesRequest): GetCommittedRunMessagesResult;
  beginCompaction(request: BeginCompactionRequest): BeginCompactionResult;
  completeCompaction(request: CompleteCompactionRequest): CompleteCompactionResult;
  endCompaction(request: EndCompactionRequest): EndCompactionResult;
  interruptRunningCompactions(
    request: InterruptRunningCompactionsRequest,
  ): InterruptRunningCompactionsResult;
}

export interface SessionIdFactories {
  sessionId?: () => string;
  entryId?: (input: { kind: 'message' | 'compaction'; source_id: string }) => string;
  attachmentId?: () => string;
}

export interface CreateSessionHistoryOptions {
  store: SessionStore;
  ids?: SessionIdFactories;
  attachmentContentStore?: SessionAttachmentContentStore;
}

export function createSessionHistory(options: CreateSessionHistoryOptions): SessionHistory {
  const implementation = new DefaultSessionHistory(options);
  return {
    saveUserMessage: (request) => implementation.saveUserMessage(request),
    saveModelResponse: (request) => implementation.saveModelResponse(request),
    saveAssistantReply: (request) => implementation.saveAssistantReply(request),
    saveToolResultMessage: (request) => implementation.saveToolResultMessage(request),
    listMessages: (request) => implementation.listMessages(request),
    listUserMessagesByExecutionIds: (request) =>
      implementation.listUserMessagesByExecutionIds(request),
    getActiveHistory: (request) => implementation.getActiveHistory(request),
    getActiveConversationHistory: (request) => implementation.getActiveConversationHistory(request),
    getCommittedBranch: (request) => implementation.getCommittedBranch(request),
    getCommittedRunMessages: (request) => implementation.getCommittedRunMessages(request),
    beginCompaction: (request) => implementation.beginCompaction(request),
    completeCompaction: (request) => implementation.completeCompaction(request),
    endCompaction: (request) => implementation.endCompaction(request),
    interruptRunningCompactions: (request) => implementation.interruptRunningCompactions(request),
  };
}

class DefaultSessionHistory implements SessionHistory {
  private readonly compactions: SessionCompactionLifecycle;
  private readonly conversation: SessionConversationReader;

  constructor(private readonly options: CreateSessionHistoryOptions) {
    this.compactions = createSessionCompactionLifecycle({
      store: options.store,
      entryId: (input) => this.entryId(input),
    });
    this.conversation = createSessionConversationReader({ store: options.store });
  }

  async saveUserMessage(request: SaveUserMessageRequest): Promise<SaveUserMessageResult> {
    const candidate: SessionMessage = {
      message_id: request.message_id,
      session_id: request.session_id,
      ...(request.execution_id ? { execution_id: request.execution_id } : {}),
      message_kind: 'user_message',
      display_content: request.display_content,
      model_content: request.model_content,
      ...(request.skill_selection ? { skill_selection: request.skill_selection } : {}),
      created_at: request.created_at,
      completed_at: request.created_at,
    };
    const existing = await this.replayUserMessage(candidate, request.attachments ?? []);
    if (existing) return existing;

    const imported: SessionMessageAttachment[] = [];
    try {
      for (const [ordinal, attachment] of (request.attachments ?? []).entries()) {
        const attachmentId = this.attachmentId();
        if (attachment.type === 'file') {
          imported.push({
            attachment_id: attachmentId,
            message_id: request.message_id,
            session_id: request.session_id,
            type: 'file',
            name: attachment.name,
            mime_type: attachment.media_type,
            source_type: 'local_file',
            source_value: attachment.local_path,
            ordinal,
            size_bytes: attachment.size_bytes,
            created_at: request.created_at,
          });
          continue;
        }
        if (!this.options.attachmentContentStore) {
          return {
            status: 'failed',
            failure: {
              code: 'attachment_store_unavailable',
              message: 'Managed attachment storage is unavailable.',
            },
          };
        }
        const stored = await this.options.attachmentContentStore.write({
          attachmentId,
          mediaType: attachment.media_type,
          bytes: attachment.bytes,
        });
        imported.push({
          attachment_id: attachmentId,
          message_id: request.message_id,
          session_id: request.session_id,
          type: 'image',
          name: attachment.name,
          mime_type: attachment.media_type,
          source_type: 'host_reference',
          source_value: stored.referenceId,
          ordinal,
          created_at: request.created_at,
        });
      }

      const result = this.options.store.runInTransaction<SaveUserMessageResult>(() => {
        const session = this.options.store.findSessionById(request.session_id);
        if (!session) return sessionNotFound(request.session_id);
        const parent = this.resolveParentEntryId({
          session_id: request.session_id,
          explicit_parent_entry_id: request.parent_entry_id,
          active_entry_id: session.active_entry_id,
        });
        if (parent.status === 'failed') return parent;

        const message = this.options.store.insertMessage(candidate);
        this.options.store.insertMessageAttachments(imported);
        const entry = this.options.store.insertEntry({
          entry_id: this.entryId({ kind: 'message', source_id: request.message_id }),
          session_id: request.session_id,
          ...(parent.parent_entry_id ? { parent_entry_id: parent.parent_entry_id } : {}),
          entry_type: 'message',
          message_id: request.message_id,
          created_at: request.created_at,
        });
        this.options.store.updateSessionActiveEntry({
          session_id: request.session_id,
          active_entry_id: entry.entry_id,
          updated_at: request.created_at,
        });
        return { status: 'saved', message: { message, attachments: imported }, entry };
      });
      if (result.status === 'failed') await this.cleanupImportedAttachments(imported);
      return result;
    } catch (error) {
      await this.cleanupImportedAttachments(imported);
      return sessionFailure(error);
    }
  }

  saveModelResponse(request: SaveModelResponseRequest): SaveModelResponseResult {
    const message: SessionMessage = {
      message_id: request.message_id,
      session_id: request.session_id,
      execution_id: request.execution_id,
      message_kind: 'model_response',
      content: request.content,
      outcome_status: request.outcome_status,
      ...(request.reason_code ? { reason_code: request.reason_code } : {}),
      ...(request.stop_reason ? { stop_reason: request.stop_reason } : {}),
      ...(request.api ? { api: request.api } : {}),
      ...(request.provider ? { provider: request.provider } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(request.response_model ? { response_model: request.response_model } : {}),
      ...(request.response_id ? { response_id: request.response_id } : {}),
      ...(request.usage ? { usage: request.usage } : {}),
      ...(request.failure ? { failure: request.failure } : {}),
      ...(request.error_message ? { error_message: request.error_message } : {}),
      created_at: request.completed_at,
      completed_at: request.completed_at,
    };
    return this.saveSynchronousMessage(message, request.parent_entry_id, 'Model Response');
  }

  saveAssistantReply(request: SaveAssistantReplyRequest): SaveAssistantReplyResult {
    const message: SessionMessage = {
      message_id: request.message_id,
      session_id: request.session_id,
      execution_id: request.execution_id,
      message_kind: 'assistant_reply',
      status: request.status,
      content: request.content,
      ...(request.reason_code ? { reason_code: request.reason_code } : {}),
      ...(request.api ? { api: request.api } : {}),
      ...(request.provider ? { provider: request.provider } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(request.response_model ? { response_model: request.response_model } : {}),
      ...(request.response_id ? { response_id: request.response_id } : {}),
      ...(request.usage ? { usage: request.usage } : {}),
      ...(request.error_message ? { error_message: request.error_message } : {}),
      created_at: request.completed_at,
      completed_at: request.completed_at,
    };
    const replay = this.replayMessage(message);
    if (replay) return replay;
    try {
      if (
        this.options.store.findAssistantReplyBySessionIdAndExecutionId({
          session_id: request.session_id,
          execution_id: request.execution_id,
        })
      ) {
        return {
          status: 'failed',
          failure: {
            code: 'assistant_reply_exists',
            message: 'Assistant Reply already exists for this Run.',
          },
        };
      }
    } catch (error) {
      return sessionFailure(error);
    }
    return this.insertSynchronousMessage(message, request.parent_entry_id, 'Assistant Reply');
  }

  saveToolResultMessage(request: SaveToolResultMessageRequest): SaveToolResultMessageResult {
    const message: SessionMessage = {
      message_id: request.message_id,
      session_id: request.session_id,
      execution_id: request.execution_id,
      message_kind: 'tool_result',
      tool_call_id: request.tool_call_id,
      tool_name: request.tool_name,
      status: request.status,
      ...(request.error ? { error: request.error } : {}),
      content: request.content,
      ...(request.usage ? { usage: request.usage } : {}),
      created_at: request.completed_at,
      completed_at: request.completed_at,
    };
    return this.saveSynchronousMessage(message, request.parent_entry_id, 'Tool Result');
  }

  listMessages(request: ListMessagesRequest): ListMessagesResult {
    try {
      const messages = request.active_path_only
        ? this.messagesForActivePath(request.session_id)
        : {
            status: 'ok' as const,
            messages: this.options.store.listMessagesBySessionId(request.session_id),
          };
      if (messages.status === 'failed') return messages;
      return { status: 'ok', messages: this.attachmentsForMessages(messages.messages) };
    } catch (error) {
      return sessionFailure(error);
    }
  }

  listUserMessagesByExecutionIds(
    request: ListUserMessagesByExecutionIdsRequest,
  ): ListUserMessagesByExecutionIdsResult {
    try {
      return {
        status: 'ok',
        messages: this.options.store.listUserMessagesByExecutionIds(request.execution_ids),
      };
    } catch (error) {
      return sessionFailure(error);
    }
  }

  getActiveHistory(request: GetActiveHistoryRequest): GetActiveHistoryResult {
    try {
      const activePath = readActivePath(
        this.options.store,
        request.session_id,
        request.through_entry_id,
      );
      if (activePath.status === 'failed') return activePath;
      const path = activePath.entries;
      const messages = this.options.store.listMessagesByIds(
        path.flatMap((entry) => (entry.message_id ? [entry.message_id] : [])),
      );
      const messagesById = new Map(messages.map((message) => [message.message_id, message]));
      const attachmentsByMessageId = groupAttachments(
        this.options.store.listAttachmentsByMessageIds([...messagesById.keys()]),
      );
      const compactions = this.options.store.listCompletedCompactionSummariesByIds(
        path.flatMap((entry) => (entry.compaction_id ? [entry.compaction_id] : [])),
      );
      const compactionsById = new Map(compactions.map((item) => [item.compaction_id, item]));
      const history: SessionHistoryItem[] = [];
      for (const entry of path) {
        if (entry.entry_type === 'message' && entry.message_id) {
          const message = messagesById.get(entry.message_id);
          if (message) {
            history.push({
              type: 'message',
              entry,
              message,
              attachments: attachmentsByMessageId.get(message.message_id) ?? [],
            });
          }
          continue;
        }
        if (entry.entry_type === 'compaction' && entry.compaction_id) {
          const compaction = compactionsById.get(entry.compaction_id);
          if (compaction) history.push({ type: 'compaction', entry, compaction });
        }
      }
      return { status: 'ok', history };
    } catch (error) {
      return sessionFailure(error);
    }
  }

  getActiveConversationHistory(
    request: GetActiveConversationHistoryRequest,
  ): GetActiveConversationHistoryResult {
    return this.conversation.getActiveHistory(request);
  }

  /** Resolves a committed Branch from the same Entry Graph rule used by full history. */
  getCommittedBranch(request: GetCommittedBranchRequest): GetCommittedBranchResult {
    return this.conversation.getCommittedBranch(request);
  }

  /** Reads one Run's messages from the current committed conversation branch. */
  getCommittedRunMessages(request: GetCommittedRunMessagesRequest): GetCommittedRunMessagesResult {
    return this.conversation.getCommittedRunMessages(request);
  }

  /** Persists the running lifecycle fact before Context emits a started event. */
  beginCompaction(request: BeginCompactionRequest): BeginCompactionResult {
    return this.compactions.begin(request);
  }

  /** Commits a successful Summary and the active semantic path atomically. */
  completeCompaction(request: CompleteCompactionRequest): CompleteCompactionResult {
    return this.compactions.complete(request);
  }

  /** Persists a non-success terminal result without changing semantic history. */
  endCompaction(request: EndCompactionRequest): EndCompactionResult {
    return this.compactions.end(request);
  }

  /** Closes running records left behind by an earlier process. */
  interruptRunningCompactions(
    request: InterruptRunningCompactionsRequest,
  ): InterruptRunningCompactionsResult {
    return this.compactions.interruptRunning(request);
  }

  private saveSynchronousMessage(
    message: SessionMessage,
    parentEntryId: string | undefined,
    label: string,
  ): SaveMessageResult {
    const replay = this.replayMessage(message);
    return replay ?? this.insertSynchronousMessage(message, parentEntryId, label);
  }

  private insertSynchronousMessage(
    message: SessionMessage,
    parentEntryId: string | undefined,
    label: string,
  ): SaveMessageResult {
    try {
      return this.options.store.runInTransaction<SaveMessageResult>(() => {
        const session = this.options.store.findSessionById(message.session_id);
        if (!session) return sessionNotFound(message.session_id);
        if (parentEntryId && session.active_entry_id !== parentEntryId) {
          return {
            status: 'failed',
            failure: {
              code: 'active_entry_changed',
              message: `Session active entry changed before ${label} append`,
            },
          };
        }
        const saved = this.options.store.insertMessage(message);
        const entry = this.options.store.insertEntry({
          entry_id: this.entryId({ kind: 'message', source_id: message.message_id }),
          session_id: message.session_id,
          ...((parentEntryId ?? session.active_entry_id)
            ? { parent_entry_id: parentEntryId ?? session.active_entry_id }
            : {}),
          entry_type: 'message',
          message_id: message.message_id,
          created_at: message.completed_at ?? message.created_at,
        });
        this.options.store.updateSessionActiveEntry({
          session_id: message.session_id,
          active_entry_id: entry.entry_id,
          updated_at: message.completed_at ?? message.created_at,
        });
        return { status: 'saved', message: saved, entry };
      });
    } catch (error) {
      return sessionFailure(error);
    }
  }

  private replayMessage(message: SessionMessage): SaveMessageResult | undefined {
    try {
      const existing = this.options.store.findMessageById(message.message_id);
      if (!existing) return undefined;
      if (!sameValue(existing, message)) return messageIdentityConflict();
      const entry = this.options.store.findMessageEntryBySessionIdAndMessageId({
        session_id: message.session_id,
        message_id: message.message_id,
      });
      return entry ? { status: 'saved', message: existing, entry } : messageIdentityConflict();
    } catch (error) {
      return sessionFailure(error);
    }
  }

  private async replayUserMessage(
    message: SessionMessage,
    requestedAttachments: SessionAttachmentImport[],
  ): Promise<SaveUserMessageResult | undefined> {
    try {
      const existing = this.options.store.findMessageById(message.message_id);
      if (!existing) return undefined;
      if (!sameValue(existing, message)) return messageIdentityConflict();
      const entry = this.options.store.findMessageEntryBySessionIdAndMessageId({
        session_id: message.session_id,
        message_id: message.message_id,
      });
      const attachments = this.options.store.listAttachmentsByMessageIds([message.message_id]);
      if (
        !entry ||
        !(await sameAttachmentImports(
          attachments,
          requestedAttachments,
          this.options.attachmentContentStore,
        ))
      ) {
        return messageIdentityConflict();
      }
      return {
        status: 'saved',
        message: { message: existing, attachments },
        entry,
      };
    } catch (error) {
      return sessionFailure(error);
    }
  }

  private messagesForActivePath(
    sessionId: string,
  ): { status: 'ok'; messages: SessionMessage[] } | { status: 'failed'; failure: SessionFailure } {
    const activePath = readActivePath(this.options.store, sessionId);
    if (activePath.status === 'failed') return activePath;
    const messageIds = activePath.entries.flatMap((entry) =>
      entry.entry_type === 'message' && entry.message_id ? [entry.message_id] : [],
    );
    const messagesById = new Map(
      this.options.store
        .listMessagesByIds(messageIds)
        .map((message) => [message.message_id, message]),
    );
    return {
      status: 'ok',
      messages: messageIds.flatMap((messageId) => {
        const message = messagesById.get(messageId);
        return message ? [message] : [];
      }),
    };
  }

  private attachmentsForMessages(messages: SessionMessage[]): SessionMessageWithAttachments[] {
    const attachmentsByMessageId = groupAttachments(
      this.options.store.listAttachmentsByMessageIds(messages.map((message) => message.message_id)),
    );
    return messages.map((message) => ({
      message,
      attachments: attachmentsByMessageId.get(message.message_id) ?? [],
    }));
  }

  private resolveParentEntryId(input: {
    session_id: string;
    explicit_parent_entry_id?: string;
    active_entry_id?: string;
  }):
    | { status: 'ok'; parent_entry_id?: string }
    | Extract<SaveUserMessageResult, { status: 'failed' }> {
    const parentEntryId = input.explicit_parent_entry_id ?? input.active_entry_id;
    if (!input.explicit_parent_entry_id) {
      return { status: 'ok', ...(parentEntryId ? { parent_entry_id: parentEntryId } : {}) };
    }
    const parent = this.options.store.findEntryById(input.explicit_parent_entry_id);
    if (!parent || parent.session_id !== input.session_id) {
      return {
        status: 'failed',
        failure: {
          code: 'invalid_parent_entry',
          message: 'parent_entry_id must belong to the same session',
        },
      };
    }
    return { status: 'ok', parent_entry_id: parentEntryId };
  }

  private entryId(input: { kind: 'message' | 'compaction'; source_id: string }): string {
    return this.options.ids?.entryId?.(input) ?? `${input.kind}:${input.source_id}`;
  }

  private attachmentId(): string {
    return this.options.ids?.attachmentId?.() ?? `attachment:${crypto.randomUUID()}`;
  }

  private async cleanupImportedAttachments(attachments: SessionMessageAttachment[]): Promise<void> {
    if (!this.options.attachmentContentStore) return;
    await Promise.all(
      attachments
        .filter((attachment) => attachment.source_type === 'host_reference')
        .map((attachment) =>
          this.options
            .attachmentContentStore!.delete(attachment.source_value)
            .catch(() => undefined),
        ),
    );
  }
}

function groupAttachments(
  attachments: SessionMessageAttachment[],
): Map<string, SessionMessageAttachment[]> {
  const grouped = new Map<string, SessionMessageAttachment[]>();
  for (const attachment of attachments) {
    const existing = grouped.get(attachment.message_id) ?? [];
    existing.push(attachment);
    grouped.set(attachment.message_id, existing);
  }
  return grouped;
}

function sessionNotFound(sessionId: string): { status: 'failed'; failure: SessionFailure } {
  return {
    status: 'failed',
    failure: { code: 'session_not_found', message: `Session ${sessionId} was not found` },
  };
}

function messageIdentityConflict(): { status: 'failed'; failure: SessionFailure } {
  return {
    status: 'failed',
    failure: {
      code: 'message_identity_conflict',
      message: 'Message identity already exists with different facts.',
    },
  };
}

async function sameAttachmentImports(
  persisted: SessionMessageAttachment[],
  requested: SessionAttachmentImport[],
  contentStore: SessionAttachmentContentStore | undefined,
): Promise<boolean> {
  if (persisted.length !== requested.length) return false;
  for (const [ordinal, attachment] of persisted.entries()) {
    const candidate = requested[ordinal];
    if (!candidate || attachment.ordinal !== ordinal || attachment.type !== candidate.type)
      return false;
    if (attachment.name !== candidate.name || attachment.mime_type !== candidate.media_type)
      return false;
    if (candidate.type === 'file') {
      if (
        attachment.source_type !== 'local_file' ||
        attachment.source_value !== candidate.local_path
      ) {
        return false;
      }
      // sizeBytes is part of the persisted document fact set: a replay that
      // disagrees on it must not silently reuse the older record.
      if (attachment.size_bytes !== candidate.size_bytes) return false;
      continue;
    }
    if (attachment.source_type !== 'host_reference' || !contentStore) return false;
    try {
      const persistedBytes = await contentStore.read(attachment.source_value);
      if (!sameBytes(persistedBytes, candidate.bytes)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

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
  readonly executionId: string;
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
          messages: result.conversation.filter(
            (item): item is SessionMessageConversationItem =>
              item.type === 'message' && item.message.execution_id === request.executionId,
          ),
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
  const completedSummaries = compactions.flatMap((record) =>
    record.status === 'completed' && record.summary ? [record.summary] : [],
  );
  const activeEntries = buildActiveConversationPath({
    session_id: sessionId,
    active_entry_id: session.active_entry_id,
    entries,
    compactions: completedSummaries,
  });
  const activeEntryIds = new Set(activeEntries.map((entry) => entry.entry_id));
  const messageEntries = activeEntries.filter((entry) => entry.entry_type === 'message');
  const messages = store.listMessagesByIds(
    messageEntries.flatMap((entry) => (entry.message_id ? [entry.message_id] : [])),
  );
  const messagesById = new Map(messages.map((message) => [message.message_id, message]));
  const attachments = groupConversationAttachments(
    store.listAttachmentsByMessageIds([...messagesById.keys()]),
  );
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
  const hasEarlierSibling = entries.some(
    (entry, index) =>
      index < targetIndex &&
      entry.entry_id !== target.entry_id &&
      entry.parent_entry_id === target.parent_entry_id,
  );
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

function groupConversationAttachments(
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
    values.sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.compactionId.localeCompare(right.compactionId),
    );
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

/**
 * Projects a legacy user message payload that stored a single `content` array
 * onto the current display_content/model_content shape. The legacy key is
 * removed so the strict payload schema accepts the converted record.
 */
export function normalizeLegacyUserMessagePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!('display_content' in payload) && 'content' in payload) {
    const { content: legacyContent, ...rest } = payload;
    return {
      ...rest,
      display_content: legacyContent,
      model_content: legacyContent,
    };
  }
  return payload;
}

/**
 * Projects legacy assistant content onto the current schema: ToolCall
 * arguments were historically stored as an `argumentsText` JSON string and are
 * read back as the `arguments` object.
 */
export function normalizeLegacyAssistantContent(
  content: readonly SessionAssistantContent[],
): readonly SessionAssistantContent[] {
  return content.map((block) => {
    if (block.type !== 'toolCall' || 'arguments' in block) return block;
    const { argumentsText, ...rest } = block as SessionAssistantContent & {
      argumentsText?: unknown;
      arguments?: unknown;
    };
    if (argumentsText === undefined) return block;
    return { ...rest, arguments: parseLegacyArguments(argumentsText) };
  });
}

function parseLegacyArguments(value: unknown): typeof SessionToolCallSchema._output.arguments {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return SessionToolCallSchema.shape.arguments.parse(
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed },
    );
  } catch {
    return { value };
  }
}

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

/*
 * Content block shapes follow the AI package's provider-neutral content
 * shapes; Session owns the persisted zod schemas for them.
 */
export const SessionTextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    textSignature: z.string().optional(),
  })
  .strict();

export type SessionTextContent = z.infer<typeof SessionTextContentSchema>;

export const SessionImageContentSchema = z
  .object({
    type: z.literal('image'),
    data: z.string().min(1),
    mimeType: z.string().min(1),
  })
  .strict();

export type SessionImageContent = z.infer<typeof SessionImageContentSchema>;

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'Expected an HTTP(S) URL.');

/** A durable snapshot of the Recommendation that started a conversation. */
export const RecommendationReferenceContentSchema = z
  .object({
    type: z.literal('recommendation_reference'),
    recommendationId: z.string().min(1),
    sourceName: z.string().trim().min(1),
    canonicalUrl: HttpUrlSchema,
    title: z.string().trim().min(1),
    author: z.string().trim().min(1).optional(),
    publishedAt: z.string().datetime({ offset: true }).optional(),
    description: z.string().trim().min(1).optional(),
    coverUrl: HttpUrlSchema.optional(),
    recommendationReason: z.string().trim().min(1).max(1000),
  })
  .strict();

export type RecommendationReferenceContent = z.infer<typeof RecommendationReferenceContentSchema>;

export const SessionUserContentSchema = z.discriminatedUnion('type', [
  SessionTextContentSchema,
  SessionImageContentSchema,
  RecommendationReferenceContentSchema,
]);

export type SessionUserContent = z.infer<typeof SessionUserContentSchema>;

export const SessionUserContentListSchema = z.array(SessionUserContentSchema);

export const SessionThinkingContentSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    thinkingSignature: z.string().optional(),
    redacted: z.boolean().optional(),
  })
  .strict();

export type SessionThinkingContent = z.infer<typeof SessionThinkingContentSchema>;

export const SessionToolCallSchema = z
  .object({
    type: z.literal('toolCall'),
    id: z.string().min(1),
    name: z.string().min(1),
    arguments: JsonObjectSchema,
    thoughtSignature: z.string().optional(),
  })
  .strict();

export type SessionToolCall = z.infer<typeof SessionToolCallSchema>;

export const SessionAssistantContentSchema = z.discriminatedUnion('type', [
  SessionTextContentSchema,
  SessionThinkingContentSchema,
  SessionToolCallSchema,
]);

export type SessionAssistantContent = z.infer<typeof SessionAssistantContentSchema>;

export const SessionAssistantContentListSchema = z.array(SessionAssistantContentSchema);

export const SESSION_MESSAGE_KINDS = [
  'user_message',
  'model_response',
  'tool_result',
  'assistant_reply',
] as const;

export type SessionMessageKind = (typeof SESSION_MESSAGE_KINDS)[number];

export const ASSISTANT_REPLY_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export type AssistantReplyStatus = (typeof ASSISTANT_REPLY_STATUSES)[number];

export const ASSISTANT_REPLY_REASON_CODES = [
  'normal_completion',
  'user_cancelled',
  'session_failed',
  'context_failed',
  'model_call_failed',
  'unsupported_content',
  'tool_call_failed',
  'approval_failed',
  'loop_limit_exceeded',
  'runtime_protocol_violation',
  'internal_error',
] as const;

export type AssistantReplyReasonCode = (typeof ASSISTANT_REPLY_REASON_CODES)[number];

export const LegacyMessageProvenanceSchema = z
  .object({
    source: z.literal('pre_final_reply_semantics'),
  })
  .strict();

export type LegacyMessageProvenance = z.infer<typeof LegacyMessageProvenanceSchema>;

export const SessionUserMessagePayloadSchema = z
  .object({
    display_content: SessionUserContentListSchema,
    model_content: SessionUserContentListSchema,
    skill_selection: z
      .object({
        name: z.string().min(1),
        skill_path: z.string().min(1),
      })
      .strict()
      .optional(),
    legacy_provenance: LegacyMessageProvenanceSchema.optional(),
  })
  .strict();

const AiUsageSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
    cacheWrite1h: z.number().int().nonnegative().optional(),
    reasoning: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative(),
    cost: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative(),
        cacheWrite: z.number().nonnegative(),
        total: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const SessionModelResponsePayloadSchema = z
  .object({
    content: z.array(SessionAssistantContentSchema),
    outcome_status: z.enum(['completed', 'incomplete', 'failed']),
    reason_code: z.string().min(1).optional(),
    stop_reason: z.string().min(1).optional(),
    api: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    response_model: z.string().min(1).optional(),
    response_id: z.string().min(1).optional(),
    usage: AiUsageSchema.optional(),
    failure: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retryable: z.boolean(),
        retryAfterMs: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    error_message: z.string().min(1).optional(),
    legacy_provenance: LegacyMessageProvenanceSchema.optional(),
  })
  .strict();

export const SessionToolResultPayloadSchema = z
  .object({
    tool_call_id: z.string().min(1),
    tool_name: z.string().min(1),
    status: z.enum(['success', 'failure', 'permission_denied', 'user_rejected', 'cancelled']),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        details: JsonObjectSchema.optional(),
      })
      .strict()
      .optional(),
    content: SessionUserContentListSchema,
    /** Tool-owned usage that never counts toward the main model Context. */
    usage: AiUsageSchema.optional(),
    legacy_provenance: LegacyMessageProvenanceSchema.optional(),
  })
  .strict();

export const SessionAssistantReplyPayloadSchema = z
  .object({
    status: z.enum(ASSISTANT_REPLY_STATUSES),
    content: z.array(SessionAssistantContentSchema),
    reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
    api: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    response_model: z.string().min(1).optional(),
    response_id: z.string().min(1).optional(),
    usage: AiUsageSchema.optional(),
    error_message: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.content.some((block) => block.type === 'toolCall')) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Assistant Reply content cannot contain Work Tool Calls.',
      });
    }
    if (payload.status === 'completed' && !hasUserVisibleAssistantContent(payload.content)) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Completed Assistant Reply requires user-visible content.',
      });
    }
  });

const SessionMessageBaseSchema = z.object({
  message_id: z.string().min(1),
  session_id: z.string().min(1),
  execution_id: z.string().min(1).optional(),
  created_at: z.string().min(1),
  completed_at: z.string().min(1).optional(),
});

export const SessionUserMessageSchema = SessionMessageBaseSchema.extend({
  message_kind: z.literal('user_message'),
  ...SessionUserMessagePayloadSchema.shape,
}).strict();

export const SessionModelResponseMessageSchema = SessionMessageBaseSchema.extend({
  message_kind: z.literal('model_response'),
  ...SessionModelResponsePayloadSchema.shape,
}).strict();

export const SessionToolResultMessageSchema = SessionMessageBaseSchema.extend({
  message_kind: z.literal('tool_result'),
  ...SessionToolResultPayloadSchema.shape,
}).strict();

export const SessionAssistantReplyMessageSchema = SessionMessageBaseSchema.extend({
  message_kind: z.literal('assistant_reply'),
  status: z.enum(ASSISTANT_REPLY_STATUSES),
  content: z.array(SessionAssistantContentSchema),
  reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
  api: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  response_model: z.string().min(1).optional(),
  response_id: z.string().min(1).optional(),
  usage: AiUsageSchema.optional(),
  error_message: z.string().min(1).optional(),
})
  .strict()
  .superRefine((message, context) => {
    const result = SessionAssistantReplyPayloadSchema.safeParse({
      status: message.status,
      content: message.content,
      ...(message.reason_code ? { reason_code: message.reason_code } : {}),
    });
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue(issue);
    }
    if (!message.execution_id) {
      context.addIssue({
        code: 'custom',
        path: ['execution_id'],
        message: 'Assistant Reply requires execution_id.',
      });
    }
    if (!message.completed_at) {
      context.addIssue({
        code: 'custom',
        path: ['completed_at'],
        message: 'Assistant Reply requires completed_at.',
      });
    }
  });

export const SessionMessageSchema = z.discriminatedUnion('message_kind', [
  SessionUserMessageSchema,
  SessionModelResponseMessageSchema,
  SessionToolResultMessageSchema,
  // Zod cannot place a refined object in a discriminated union. Repository
  // and History boundaries apply the complete Assistant Reply validation.
  SessionMessageBaseSchema.extend({
    message_kind: z.literal('assistant_reply'),
    status: z.enum(ASSISTANT_REPLY_STATUSES),
    content: z.array(SessionAssistantContentSchema),
    reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
    api: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    response_model: z.string().min(1).optional(),
    response_id: z.string().min(1).optional(),
    usage: AiUsageSchema.optional(),
    error_message: z.string().min(1).optional(),
  }).strict(),
]);

/** The persisted user message, named without a Session prefix per the Context Spec. */
export type UserMessage = z.infer<typeof SessionUserMessageSchema>;

export type SessionModelResponseMessage = z.infer<typeof SessionModelResponseMessageSchema>;

export type SessionToolResultMessage = z.infer<typeof SessionToolResultMessageSchema>;

export type SessionAssistantReplyMessage = z.infer<typeof SessionAssistantReplyMessageSchema>;

export type SessionMessage =
  | UserMessage
  | SessionModelResponseMessage
  | SessionToolResultMessage
  | SessionAssistantReplyMessage;

export interface SessionMessageWithAttachments {
  message: SessionMessage;
  attachments: SessionMessageAttachment[];
  /** Zero-based position of this message Entry on the current active path. */
  active_path_order?: number;
}

export type SessionMessageContent = SessionUserContent[] | SessionAssistantContent[];

export function sessionMessageText(message: SessionMessage): string {
  const blocks =
    message.message_kind === 'user_message' ? message.display_content : message.content;
  return blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
}

export function hasUserVisibleAssistantContent(content: SessionAssistantContent[]): boolean {
  return content.some((block) => block.type === 'text' && block.text.trim().length > 0);
}

export function isLegacySessionMessage(message: SessionMessage): boolean {
  return (
    'legacy_provenance' in message &&
    message.legacy_provenance?.source === 'pre_final_reply_semantics'
  );
}

/** Binds the accepted Coding input to Agent's awaited message persistence hook. */
export function createSessionMessageSaver(options: {
  readonly history: SessionHistory;
  readonly user: Omit<SaveUserMessageRequest, 'message_id' | 'execution_id' | 'created_at'>;
  readonly onUserSaved?: (saved: Extract<SaveUserMessageResult, { status: 'saved' }>) => void;
}): (request: import('@megumi/agent').SaveMessageRequest) => Promise<void> {
  return async ({ runId, messageId, message }) => {
    const identity = {
      message_id: messageId,
      session_id: options.user.session_id,
      execution_id: runId,
    };
    if (message.role === 'user') {
      const saved = await options.history.saveUserMessage({
        ...options.user,
        ...identity,
        created_at: new Date(message.timestamp).toISOString(),
      });
      if (saved.status === 'failed') throw new Error(saved.failure.message);
      options.onUserSaved?.(saved);
      return;
    }
    let saved: SaveMessageResult;
    if (message.role === 'assistant') {
      const metadata = {
        api: message.api,
        provider: message.provider,
        model: message.model,
        response_model: message.responseModel,
        response_id: message.responseId,
        usage: message.usage,
        error_message: message.errorMessage,
      };
      const content = message.content.map((block) => ({ ...block }));
      const completed_at = new Date(message.timestamp).toISOString();
      const hasCalls = content.some((block) => block.type === 'toolCall');
      saved = hasCalls
        ? options.history.saveModelResponse({
            ...identity,
            ...metadata,
            content,
            completed_at,
            outcome_status: 'completed',
            stop_reason: message.stopReason,
          })
        : options.history.saveAssistantReply({
            ...identity,
            ...metadata,
            content,
            completed_at,
            ...(message.stopReason === 'aborted' ? { reason_code: 'user_cancelled' as const } : {}),
            status:
              message.stopReason === 'aborted'
                ? 'cancelled'
                : message.stopReason === 'error'
                  ? 'failed'
                  : 'completed',
          });
    } else if (message.role === 'toolResult') {
      const detail = message.details;
      const error =
        detail && typeof detail === 'object' && !Array.isArray(detail) && 'error' in detail
          ? detail.error
          : undefined;
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined;
      saved = options.history.saveToolResultMessage({
        ...identity,
        tool_call_id: message.toolCallId,
        tool_name: message.toolName,
        content: [...message.content],
        usage: message.usage,
        completed_at: new Date(message.timestamp).toISOString(),
        status:
          code === 'permission_denied'
            ? 'permission_denied'
            : code === 'tool_cancelled'
              ? 'cancelled'
              : message.isError
                ? 'failure'
                : 'success',
        error: code
          ? {
              code,
              message: message.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join(''),
            }
          : undefined,
      });
    } else {
      throw new Error('System prompt messages do not belong to session history.');
    }
    if (saved.status === 'failed') throw new Error(saved.failure.message);
  };
}

/** Persists the existing terminal reply marker when execution ended without a final reply. */
export function saveInterruptedReply(input: {
  readonly history: SessionHistory;
  readonly sessionId: string;
  readonly result: import('@megumi/agent').AgentResult;
}): void {
  const { result, history, sessionId } = input;
  if (
    result.status === 'completed' ||
    (result.status === 'failed' && result.error.code === 'MESSAGE_SAVE_FAILED')
  )
    return;
  const committed = history.getCommittedRunMessages({ sessionId, executionId: result.runId });
  if (committed.status === 'failed') throw new Error(committed.failure.message);
  if (
    !committed.messages.length ||
    committed.messages.some((item) => item.message.message_kind === 'assistant_reply')
  )
    return;
  const reasons: Record<import('@megumi/agent').AgentError['code'], AssistantReplyReasonCode> = {
    MESSAGE_SAVE_FAILED: 'session_failed',
    CONTEXT_FAILED: 'context_failed',
    CONTEXT_OVERFLOW: 'context_failed',
    MODEL_CALL_FAILED: 'model_call_failed',
    MODEL_TIMEOUT: 'model_call_failed',
    MODEL_PROTOCOL_ERROR: 'runtime_protocol_violation',
    TOOL_SYSTEM_FAILED: 'tool_call_failed',
    EXECUTION_LIMIT_REACHED: 'loop_limit_exceeded',
    CLEANUP_FAILED: 'internal_error',
  };
  const saved = history.saveAssistantReply({
    message_id: crypto.randomUUID(),
    session_id: sessionId,
    execution_id: result.runId,
    status: result.status,
    content: [],
    reason_code: result.status === 'cancelled' ? 'user_cancelled' : reasons[result.error.code],
    completed_at: new Date().toISOString(),
  });
  if (saved.status === 'failed') throw new Error(saved.failure.message);
}
