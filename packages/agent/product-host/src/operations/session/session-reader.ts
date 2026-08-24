/*
 * Composes Session page facts from their owning modules and maps them to
 * host-safe DTOs without constructing Desktop Timeline presentation state.
 */
import type { AgentExecutions, ExecutionSnapshot } from '@megumi/execution';
import type { EventBus } from '@megumi/events';
import type {
  Session,
  SessionAssistantContent,
  SessionCatalog,
  SessionConversationItem,
  SessionHistory,
  SessionMessage,
  SessionMessageAttachment,
  SessionMessageConversationItem,
  SessionUserContent,
} from '@megumi/session';
import type { WorkspaceChangeSummary, WorkspaceChanges } from '@megumi/workspace';
import type {
  HostFailure,
  ReadCommittedRunRequest,
  ReadCommittedRunResult,
  ReadSessionRequest,
  ReadSessionResult,
  RunDto,
  SessionConversationItemDto,
  SessionDto,
  SessionMessageConversationItemDto,
  SessionMessageDto,
  SessionReadDiagnosticDto,
  UserMessageDto,
  WorkspaceChangeSummaryDto,
} from '../../host/session-host';

export interface SessionReader {
  /** Aggregates recoverable Session facts with current-process runtime facts. */
  readSession(request: ReadSessionRequest): Promise<ReadSessionResult>;
  /** Reads only committed facts for one terminal Run reconciliation. */
  readCommittedRun(request: ReadCommittedRunRequest): Promise<ReadCommittedRunResult>;
}

export interface CreateSessionReaderOptions {
  readonly sessions: Pick<SessionCatalog, 'getSession'>;
  readonly history: Pick<
    SessionHistory,
    'getActiveConversationHistory' | 'getCommittedRunMessages'
  >;
  readonly executions: Pick<AgentExecutions, 'getActive'>;
  readonly events: Pick<EventBus, 'read'>;
  readonly workspaceChanges: Pick<WorkspaceChanges, 'listChangeSummaries'>;
}

/** Creates the Product reader without introducing a second read-model owner. */
export function createSessionReader(options: CreateSessionReaderOptions): SessionReader {
  return {
    /**
     * Reads the recoverable Session facts first, then adds current-process Run
     * and Event facts. Optional Workspace Change failures become diagnostics so
     * they cannot make the conversation itself unreadable.
     */
    async readSession(request) {
      try {
        const sessionResult = options.sessions.getSession({ session_id: request.sessionId });
        if (sessionResult.status === 'not_found') {
          return { status: 'not_found', sessionId: request.sessionId };
        }
        if (sessionResult.status === 'failed') {
          return { status: 'failed', failure: toHostFailure(sessionResult.failure) };
        }

        const conversationResult = options.history.getActiveConversationHistory({
          session_id: request.sessionId,
        });
        if (conversationResult.status === 'failed') {
          return { status: 'failed', failure: toHostFailure(conversationResult.failure) };
        }

        const activeRunResult = options.executions.getActive({ sessionId: request.sessionId });
        const eventResult = options.events.read({ sessionId: request.sessionId });
        const executionIds = collectExecutionIds(
          conversationResult.conversation,
          activeRunResult.status === 'found' ? activeRunResult.execution.executionId : undefined,
        );
        const workspace = readWorkspaceChanges(options.workspaceChanges, executionIds);

        return {
          status: 'ok',
          session: toSessionDto(sessionResult.session),
          conversation: conversationResult.conversation.map(toConversationItemDto),
          ...(activeRunResult.status === 'found' ? { activeRun: toRunDto(activeRunResult.execution) } : {}),
          runtimeEvents: [...eventResult.events],
          eventRange: {
            ...(eventResult.firstSequence === undefined ? {} : { firstSequence: eventResult.firstSequence }),
            ...(eventResult.lastSequence === undefined ? {} : { lastSequence: eventResult.lastSequence }),
            truncated: eventResult.truncated,
          },
          workspaceChanges: workspace.summaries,
          diagnostics: workspace.diagnostics,
        };
      } catch (error) {
        return { status: 'failed', failure: unexpectedFailure(error) };
      }
    },

    /**
     * Reads only the committed messages and Workspace Changes for one Run.
     * Agent Execution state and recent Events are deliberately excluded from this
     * terminal reconciliation query.
     */
    async readCommittedRun(request) {
      try {
        const messagesResult = options.history.getCommittedRunMessages(request);
        if (messagesResult.status === 'failed') {
          return { status: 'failed', failure: toHostFailure(messagesResult.failure) };
        }
        if (messagesResult.messages.length === 0) {
          return { status: 'not_found', executionId: request.executionId };
        }
        const workspace = readWorkspaceChanges(options.workspaceChanges, [request.executionId]);
        return {
          status: 'ok',
          messages: messagesResult.messages.map(toMessageConversationItemDto),
          workspaceChanges: workspace.summaries,
          diagnostics: workspace.diagnostics,
        };
      } catch (error) {
        return { status: 'failed', failure: unexpectedFailure(error) };
      }
    },
  };
}

export function toSessionDto(session: Session): SessionDto {
  return {
    id: session.session_id,
    projectId: session.workspace_id,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

export function toRunDto(execution: ExecutionSnapshot): RunDto {
  if (execution.kind !== 'conversation') {
    throw new Error('Session operations received a non-conversation execution.');
  }
  return {
    executionId: execution.executionId,
    sessionId: execution.sessionId,
    status: execution.status,
    createdAt: execution.createdAt,
    ...(execution.completedAt ? { completedAt: execution.completedAt } : {}),
  };
}

export function toUserMessageDto(input: {
  readonly message: Extract<SessionMessage, { message_kind: 'user_message' }>;
  readonly attachments: readonly SessionMessageAttachment[];
}): UserMessageDto {
  const message = input.message;
  return {
    ...messageIdentity(message),
    kind: 'user',
    displayContent: message.display_content.map(copyUserContent),
    ...(message.skill_selection ? {
      skillSelection: {
        name: message.skill_selection.name,
        skillPath: message.skill_selection.skill_path,
      },
    } : {}),
    attachments: input.attachments.map((attachment) => ({
      attachmentId: attachment.attachment_id,
      type: attachment.type,
      ...(attachment.name ? { name: attachment.name } : {}),
      ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
      source: attachment.source_type === 'local_file' ? 'localFile' : 'managed',
      ordinal: attachment.ordinal,
      ...(attachment.size_bytes === undefined ? {} : { sizeBytes: attachment.size_bytes }),
      createdAt: attachment.created_at,
    })),
  };
}

function toConversationItemDto(item: SessionConversationItem): SessionConversationItemDto {
  if (item.type === 'message') return toMessageConversationItemDto(item);
  if (item.type === 'branch') {
    return {
      type: 'branch',
      branchId: item.branchId,
      sourceMessageId: item.sourceMessageId,
      targetMessageId: item.targetMessageId,
      createdAt: item.createdAt,
    };
  }
  return {
    type: 'compaction',
    compactionId: item.compactionId,
    trigger: item.trigger,
    status: item.status,
    ...(item.error ? {
      error: {
        ...(item.error.code ? { code: item.error.code } : {}),
        message: item.error.message,
      },
    } : {}),
    startedAt: item.startedAt,
    ...(item.completedAt ? { completedAt: item.completedAt } : {}),
  };
}

function toMessageConversationItemDto(
  item: SessionMessageConversationItem,
): SessionMessageConversationItemDto {
  return {
    type: 'message',
    entryId: item.entryId,
    ...(item.parentEntryId ? { parentEntryId: item.parentEntryId } : {}),
    message: toMessageDto(item.message, item.attachments),
  };
}

function toMessageDto(
  message: SessionMessage,
  attachments: readonly SessionMessageAttachment[],
): SessionMessageDto {
  if (message.message_kind === 'user_message') {
    return toUserMessageDto({ message, attachments });
  }
  if (message.message_kind === 'model_response') {
    return {
      ...messageIdentity(message),
      kind: 'modelResponse',
      content: message.content.map(copyAssistantContent),
      outcomeStatus: message.outcome_status,
      ...(message.reason_code ? { reasonCode: message.reason_code } : {}),
      ...(message.stop_reason ? { stopReason: message.stop_reason } : {}),
      ...modelFacts(message),
      ...(message.usage ? { usage: copyUsage(message.usage) } : {}),
      ...(message.failure ? { failure: { ...message.failure } } : {}),
      ...(message.error_message ? { errorMessage: message.error_message } : {}),
    };
  }
  if (message.message_kind === 'tool_result') {
    return {
      ...messageIdentity(message),
      kind: 'toolResult',
      toolCallId: message.tool_call_id,
      toolName: message.tool_name,
      status: message.status,
      content: message.content.map(copyUserContent),
      ...(message.usage ? { usage: copyUsage(message.usage) } : {}),
      ...(message.error ? {
        error: {
          code: message.error.code,
          message: message.error.message,
          ...(message.error.details ? { details: structuredClone(message.error.details) } : {}),
        },
      } : {}),
    };
  }
  return {
    ...messageIdentity(message),
    kind: 'assistantReply',
    status: message.status,
    content: message.content.map(copyAssistantContent),
    ...(message.reason_code ? { reasonCode: message.reason_code } : {}),
    ...modelFacts(message),
    ...(message.usage ? { usage: copyUsage(message.usage) } : {}),
    ...(message.error_message ? { errorMessage: message.error_message } : {}),
  };
}

function messageIdentity(message: SessionMessage) {
  return {
    messageId: message.message_id,
    sessionId: message.session_id,
    ...(message.execution_id ? { executionId: message.execution_id } : {}),
    createdAt: message.created_at,
    ...(message.completed_at ? { completedAt: message.completed_at } : {}),
  };
}

function modelFacts(message: Extract<SessionMessage, {
  message_kind: 'model_response' | 'assistant_reply';
}>) {
  return {
    ...(message.api ? { api: message.api } : {}),
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.model ? { model: message.model } : {}),
    ...(message.response_model ? { responseModel: message.response_model } : {}),
    ...(message.response_id ? { responseId: message.response_id } : {}),
  };
}

function copyUserContent(content: SessionUserContent): SessionUserContent {
  return content.type === 'text' ? { ...content } : { ...content };
}

function copyAssistantContent(content: SessionAssistantContent): SessionAssistantContent {
  return content.type === 'toolCall'
    ? { ...content, arguments: structuredClone(content.arguments) }
    : { ...content };
}

function copyUsage(usage: import('@megumi/ai').Usage): import('@megumi/ai').Usage {
  return { ...usage, cost: { ...usage.cost } };
}

function collectExecutionIds(
  conversation: readonly SessionConversationItem[],
  activeExecutionId?: string,
): string[] {
  const executionIds = new Set<string>();
  for (const item of conversation) {
    if (item.type === 'message' && item.message.execution_id) executionIds.add(item.message.execution_id);
  }
  if (activeExecutionId) executionIds.add(activeExecutionId);
  return [...executionIds];
}

/** Reads optional Workspace facts independently so one damaged Run does not hide the others. */
function readWorkspaceChanges(
  workspaceChanges: Pick<WorkspaceChanges, 'listChangeSummaries'>,
  executionIds: readonly string[],
): {
  readonly summaries: WorkspaceChangeSummaryDto[];
  readonly diagnostics: SessionReadDiagnosticDto[];
} {
  const summaries: WorkspaceChangeSummaryDto[] = [];
  const diagnostics: SessionReadDiagnosticDto[] = [];
  for (const executionId of executionIds) {
    try {
      summaries.push(...workspaceChanges.listChangeSummaries({ by: 'run', execution_id: executionId })
        .summaries.map(toWorkspaceChangeSummaryDto));
    } catch (error) {
      diagnostics.push({
        code: 'workspace_changes_unavailable',
        message: error instanceof Error ? error.message : 'Workspace Changes could not be read.',
        executionId,
      });
    }
  }
  return { summaries, diagnostics };
}

function toWorkspaceChangeSummaryDto(summary: WorkspaceChangeSummary): WorkspaceChangeSummaryDto {
  return {
    executionId: summary.change_set.execution_id,
    sessionId: summary.change_set.session_id,
    changeSetId: summary.change_set.change_set_id,
    changedFileCount: summary.change_set.changed_file_count,
    files: summary.files.map((file) => ({
      changedFileId: file.changed_file_id,
      workspacePath: file.workspace_path,
      changeKind: file.change_kind,
    })),
    updatedAt: summary.change_set.finalized_at ?? summary.change_set.created_at,
  };
}

function toHostFailure(failure: {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
}): HostFailure {
  return {
    code: failure.code,
    message: failure.message,
    ...(failure.retryable === undefined ? {} : { retryable: failure.retryable }),
  };
}

function unexpectedFailure(error: unknown): HostFailure {
  return {
    code: 'session_read_failed',
    message: error instanceof Error ? error.message : 'Session facts could not be read.',
  };
}
