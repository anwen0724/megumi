/*
 * Owns the single Session Entry chain inside an Engine Agent execution: model responses,
 * ordered tool results and completed/failed/cancelled assistant replies all
 * commit through this committer, and the one lastCommittedEntryId advances
 * only after Session reports the save as successful. The Engine Agent Adapter decides
 * what to commit and when; the committer never publishes Runtime Events and
 * never decides whether the loop continues or the Run ends.
 */
import type { SessionHistory, SessionEntry, SessionAssistantContent, AssistantReplyReasonCode } from '@megumi/session';
import type { Usage } from '@megumi/ai';

/** Assistant reply metadata passthrough kept identical to the Session save contract. */
export interface AssistantReplyMetadata {
  readonly api?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly response_model?: string;
  readonly response_id?: string;
  readonly usage?: Usage;
  readonly error_message?: string;
}

/** The ToolCall result facts the Engine Agent Adapter decides to persist. */
export interface SessionToolResultCommit {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly callOrder: number;
  readonly status: 'success' | 'failure' | 'permission_denied' | 'user_rejected' | 'cancelled';
  readonly error?: { readonly code: string; readonly message: string };
  readonly content: string;
  readonly completedAt: string;
}

export type CommitReplyResult =
  | { readonly status: 'saved'; readonly messageId: string; readonly entryId: string }
  | { readonly status: 'failed'; readonly failure: { readonly message: string } };

export interface CommittedToolResult {
  readonly toolCallId: string;
  readonly messageId: string;
  readonly status: SessionToolResultCommit['status'];
}

export type CommitToolResultsResult =
  | { readonly status: 'saved'; readonly items: readonly CommittedToolResult[] }
  | {
      readonly status: 'failed';
      readonly failure: { readonly message: string };
      /** The items really saved before the failure: they are real Session facts. */
      readonly items: readonly CommittedToolResult[];
    };

export interface SessionMessageCommitter {
  commitModelResponse(input: {
    readonly sessionId: string;
    readonly executionId: string;
    readonly messageId: string;
    readonly content: readonly SessionAssistantContent[];
    readonly stopReason: string;
    readonly metadata?: AssistantReplyMetadata;
    readonly completedAt: string;
  }): Promise<CommitReplyResult>;
  commitToolResults(input: {
    readonly sessionId: string;
    readonly executionId: string;
    readonly results: readonly SessionToolResultCommit[];
  }): Promise<CommitToolResultsResult>;
  commitAssistantReply(input: {
    readonly sessionId: string;
    readonly executionId: string;
    readonly status: 'completed' | 'failed' | 'cancelled';
    readonly content: readonly SessionAssistantContent[];
    readonly reasonCode?: AssistantReplyReasonCode;
    /** Reuses the streaming identity when a message lifecycle was started. */
    readonly messageId?: string;
    readonly metadata?: AssistantReplyMetadata;
    readonly completedAt: string;
  }): Promise<CommitReplyResult>;
}

export interface CreateSessionMessageCommitterOptions {
  /** The Run's committed User Entry: the first parent of the Entry chain. */
  readonly userEntry: SessionEntry;
  readonly session: Pick<
    SessionHistory,
    'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'
  >;
  readonly ids: { createSessionMessageId(): string };
}

export function createSessionMessageCommitter(
  options: CreateSessionMessageCommitterOptions,
): SessionMessageCommitter {
  // The only lastCommittedEntryId of a Run lives here; it advances only when
  // Session confirmed the save, so a failed commit never orphans the chain.
  let lastCommittedEntryId = options.userEntry.entry_id;

  return {
    async commitModelResponse(input) {
      const saved = await options.session.saveModelResponse({
        message_id: input.messageId,
        session_id: input.sessionId,
        execution_id: input.executionId,
        parent_entry_id: lastCommittedEntryId,
        content: [...input.content],
        outcome_status: 'completed',
        stop_reason: input.stopReason,
        ...input.metadata,
        completed_at: input.completedAt,
      });
      if (saved.status === 'failed') {
        return { status: 'failed', failure: { message: saved.failure.message } };
      }
      lastCommittedEntryId = saved.entry.entry_id;
      return { status: 'saved', messageId: saved.message.message_id, entryId: saved.entry.entry_id };
    },

    async commitToolResults(input) {
      // Results persist in the model's original ToolCall order; the chain
      // advances one entry per committed result.
      const items: CommittedToolResult[] = [];
      for (const result of [...input.results].sort((left, right) => left.callOrder - right.callOrder)) {
        const saved = await options.session.saveToolResultMessage({
          message_id: options.ids.createSessionMessageId(),
          session_id: input.sessionId,
          execution_id: input.executionId,
          parent_entry_id: lastCommittedEntryId,
          tool_call_id: result.toolCallId,
          tool_name: result.toolName,
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
          content: [{ type: 'text', text: result.content }],
          completed_at: result.completedAt,
        });
        if (saved.status === 'failed') {
          // The chain stays on the last real successful commit; the partial
          // successes are still returned because they are real Session facts.
          return {
            status: 'failed',
            failure: { message: saved.failure.message },
            items: [...items],
          };
        }
        lastCommittedEntryId = saved.entry.entry_id;
        items.push({
          toolCallId: result.toolCallId,
          messageId: saved.message.message_id,
          status: result.status,
        });
      }
      return { status: 'saved', items };
    },

    async commitAssistantReply(input) {
      const saved = await options.session.saveAssistantReply({
        // Reuse the streaming identity when a message lifecycle was started;
        // otherwise settle a fresh reply for the Run.
        message_id: input.messageId ?? options.ids.createSessionMessageId(),
        session_id: input.sessionId,
        execution_id: input.executionId,
        parent_entry_id: lastCommittedEntryId,
        status: input.status,
        content: [...input.content],
        ...(input.reasonCode ? { reason_code: input.reasonCode } : {}),
        ...input.metadata,
        completed_at: input.completedAt,
      });
      if (saved.status === 'failed') {
        return { status: 'failed', failure: { message: saved.failure.message } };
      }
      lastCommittedEntryId = saved.entry.entry_id;
      return { status: 'saved', messageId: saved.message.message_id, entryId: saved.entry.entry_id };
    },
  };
}
