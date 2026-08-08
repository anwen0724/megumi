/* Owns Session semantic message commits, active history, and compaction facts. */
import type {
  SessionAttachmentContentStore,
  SessionAttachmentImport,
  SessionMessageAttachment,
} from './session-attachment';
import {
  readActivePath,
  type SessionEntry,
  type SessionHistoryItem,
} from './session-entry-graph';
import {
  createSessionCompactionLifecycle,
  type BeginCompactionRequest,
  type BeginCompactionResult,
  type CompleteCompactionRequest,
  type CompleteCompactionResult,
  type EndCompactionRequest,
  type EndCompactionResult,
  type InterruptRunningCompactionsRequest,
  type InterruptRunningCompactionsResult,
  type SessionCompactionLifecycle,
} from './session-compaction';
import {
  createSessionConversationReader,
  type GetActiveConversationHistoryRequest,
  type GetActiveConversationHistoryResult,
  type GetCommittedBranchRequest,
  type GetCommittedBranchResult,
  type SessionConversationReader,
} from './session-conversation';
import type {
  AssistantReplyReasonCode,
  AssistantReplyStatus,
  SessionAssistantContent,
  SessionMessage,
  SessionMessageWithAttachments,
  SessionUserContent,
} from './session-message';
import { sessionFailure, type SessionFailure } from './session';
import type { SessionStore } from './session-store';

export interface SaveUserMessageRequest {
  message_id: string;
  session_id: string;
  run_id?: string;
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
  run_id: string;
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
  run_id: string;
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
  run_id: string;
  parent_entry_id?: string;
  tool_call_id: string;
  tool_name: string;
  status: 'success' | 'failure' | 'permission_denied' | 'user_rejected' | 'cancelled';
  error?: { code: string; message: string; details?: Record<string, unknown> };
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

export interface ListUserMessagesByRunIdsRequest {
  run_ids: string[];
}

export type ListUserMessagesByRunIdsResult =
  | { status: 'ok'; messages: SessionMessage[] }
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
  listUserMessagesByRunIds(request: ListUserMessagesByRunIdsRequest): ListUserMessagesByRunIdsResult;
  getActiveHistory(request: GetActiveHistoryRequest): GetActiveHistoryResult;
  getActiveConversationHistory(
    request: GetActiveConversationHistoryRequest,
  ): GetActiveConversationHistoryResult;
  getCommittedBranch(request: GetCommittedBranchRequest): GetCommittedBranchResult;
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
    listUserMessagesByRunIds: (request) => implementation.listUserMessagesByRunIds(request),
    getActiveHistory: (request) => implementation.getActiveHistory(request),
    getActiveConversationHistory: (request) => implementation.getActiveConversationHistory(request),
    getCommittedBranch: (request) => implementation.getCommittedBranch(request),
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
      ...(request.run_id ? { run_id: request.run_id } : {}),
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
        this.options.store.updateActiveEntry({
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
      run_id: request.run_id,
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
      run_id: request.run_id,
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
      if (this.options.store.findAssistantReplyByRunId(request.session_id, request.run_id)) {
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
      run_id: request.run_id,
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

  listUserMessagesByRunIds(
    request: ListUserMessagesByRunIdsRequest,
  ): ListUserMessagesByRunIdsResult {
    try {
      return {
        status: 'ok',
        messages: this.options.store.listUserMessagesByRunIds(request.run_ids),
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
        path.flatMap((entry) => entry.message_id ? [entry.message_id] : []),
      );
      const messagesById = new Map(messages.map((message) => [message.message_id, message]));
      const attachmentsByMessageId = groupAttachments(
        this.options.store.listAttachmentsByMessageIds([...messagesById.keys()]),
      );
      const compactions = this.options.store.listCompactionSummariesByIds(
        path.flatMap((entry) => entry.compaction_id ? [entry.compaction_id] : []),
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
        this.options.store.updateActiveEntry({
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
      const entry = this.options.store.findMessageEntry({
        session_id: message.session_id,
        message_id: message.message_id,
      });
      return entry
        ? { status: 'saved', message: existing, entry }
        : messageIdentityConflict();
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
      const entry = this.options.store.findMessageEntry({
        session_id: message.session_id,
        message_id: message.message_id,
      });
      const attachments = this.options.store.listAttachmentsByMessageIds([message.message_id]);
      if (
        !entry
        || !(await sameAttachmentImports(
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

  private messagesForActivePath(sessionId: string):
    | { status: 'ok'; messages: SessionMessage[] }
    | { status: 'failed'; failure: SessionFailure } {
    const activePath = readActivePath(this.options.store, sessionId);
    if (activePath.status === 'failed') return activePath;
    const messageIds = activePath.entries.flatMap((entry) => (
      entry.entry_type === 'message' && entry.message_id ? [entry.message_id] : []
    ));
    const messagesById = new Map(
      this.options.store.listMessagesByIds(messageIds).map((message) => [message.message_id, message]),
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
  }): { status: 'ok'; parent_entry_id?: string } | Extract<SaveUserMessageResult, { status: 'failed' }> {
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

  private async cleanupImportedAttachments(
    attachments: SessionMessageAttachment[],
  ): Promise<void> {
    if (!this.options.attachmentContentStore) return;
    await Promise.all(attachments
      .filter((attachment) => attachment.source_type === 'host_reference')
      .map((attachment) => (
        this.options.attachmentContentStore!.delete(attachment.source_value).catch(() => undefined)
      )));
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
    if (!candidate || attachment.ordinal !== ordinal || attachment.type !== candidate.type) return false;
    if (attachment.name !== candidate.name || attachment.mime_type !== candidate.media_type) return false;
    if (candidate.type === 'file') {
      if (attachment.source_type !== 'local_file' || attachment.source_value !== candidate.local_path) {
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
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
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
