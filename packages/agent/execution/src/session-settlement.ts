/*
 * Owns the single Session Entry chain inside one Agent execution: model
 * responses, ordered tool results and the unique final assistant reply all
 * commit through this committer, and the one lastCommittedEntryId advances
 * only after Session reports the save as successful. It never publishes
 * Runtime Events and never decides whether the loop continues.
 */
import type {
  AssistantReplyReasonCode,
  SessionAssistantContent,
  SessionEntry,
  SessionHistory,
} from '@megumi/session';
import type { Usage } from '@megumi/ai';
import {
  createContentDigest,
  type Observability,
  type OperationCompletion,
  type TraceCorrelation,
} from '@megumi/observability';

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

/** The ToolCall result facts the Tool Adapter decides to persist. */
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
  /** The execution's committed User Entry: the first parent of the Entry chain. */
  readonly userEntry: SessionEntry;
  readonly session: Pick<
    SessionHistory,
    'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'
  >;
  readonly ids: { createSessionMessageId(): string };
  readonly observability?: Observability;
}

/** A Session commit failure surfaced through the Agent listener or settlement seam. */
export class SessionCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionCommitError';
  }
}

export function createSessionMessageCommitter(
  options: CreateSessionMessageCommitterOptions,
): SessionMessageCommitter {
  // The only lastCommittedEntryId of an execution lives here; it advances only
  // when Session confirmed the save, so a failed commit never orphans the chain.
  let lastCommittedEntryId = options.userEntry.entry_id;

  return {
    async commitModelResponse(input) {
      const request: Parameters<typeof options.session.saveModelResponse>[0] = {
        message_id: input.messageId,
        session_id: input.sessionId,
        execution_id: input.executionId,
        parent_entry_id: lastCommittedEntryId,
        content: [...input.content],
        outcome_status: 'completed',
        stop_reason: input.stopReason,
        ...input.metadata,
        completed_at: input.completedAt,
      };
      const saved = await commitSessionMessage(
        options.observability,
        commitCorrelation(input, request.content),
        () => options.session.saveModelResponse(request),
      );
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
        const request: Parameters<typeof options.session.saveToolResultMessage>[0] = {
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
        };
        const saved = await commitSessionMessage(
          options.observability,
          commitCorrelation({
            sessionId: input.sessionId,
            executionId: input.executionId,
            messageId: request.message_id,
            toolCallId: result.toolCallId,
          }, request.content),
          () => options.session.saveToolResultMessage(request),
        );
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
      const request: Parameters<typeof options.session.saveAssistantReply>[0] = {
        // Reuse the streaming identity when a message lifecycle was started;
        // otherwise settle a fresh reply for the execution.
        message_id: input.messageId ?? options.ids.createSessionMessageId(),
        session_id: input.sessionId,
        execution_id: input.executionId,
        parent_entry_id: lastCommittedEntryId,
        status: input.status,
        content: [...input.content],
        ...(input.reasonCode ? { reason_code: input.reasonCode } : {}),
        ...input.metadata,
        completed_at: input.completedAt,
      };
      const saved = await commitSessionMessage(
        options.observability,
        commitCorrelation({ ...input, messageId: request.message_id }, request.content),
        () => options.session.saveAssistantReply(request),
      );
      if (saved.status === 'failed') {
        return { status: 'failed', failure: { message: saved.failure.message } };
      }
      lastCommittedEntryId = saved.entry.entry_id;
      return { status: 'saved', messageId: saved.message.message_id, entryId: saved.entry.entry_id };
    },
  };
}

interface CommitIdentity {
  readonly sessionId: string;
  readonly executionId: string;
  readonly messageId: string;
  readonly toolCallId?: string;
}

interface SessionSaveResult {
  readonly status: 'saved' | 'failed';
  readonly failure?: { readonly code: string; readonly message: string };
}

function commitCorrelation(identity: CommitIdentity, content: unknown): TraceCorrelation {
  const contentDigest = createContentDigest(content);
  return {
    sessionId: identity.sessionId,
    executionId: identity.executionId,
    messageId: identity.messageId,
    ...(identity.toolCallId ? { toolCallId: identity.toolCallId } : {}),
    ...(contentDigest ? { contentDigest } : {}),
  };
}

/** Keeps Session authoritative and single-shot even if an injected diagnostic adapter fails. */
async function commitSessionMessage<T extends SessionSaveResult>(
  observability: Observability | undefined,
  correlation: TraceCorrelation,
  operation: () => T | Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> => {
    operationPromise ??= Promise.resolve().then(operation);
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name: 'session.message.commit',
      correlation,
      classifyResult: classifySessionCommit,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifySessionCommit(result: SessionSaveResult): OperationCompletion {
  if (result.status === 'saved') return { outcome: { status: 'ok', code: 'saved' } };
  return {
    outcome: {
      status: 'error',
      code: result.failure?.code ?? 'session_commit_failed',
      message: result.failure?.message ?? 'Session message commit failed.',
    },
  };
}
