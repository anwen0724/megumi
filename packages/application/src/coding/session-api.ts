/* Exposes Coding session operations and projects committed history for the desktop. */
import type { EventBus } from './events/event-bus';
import { estimateContextTokens } from '@megumi/ai/utils/estimate';
import type { AttachmentPicker } from '../platform/attachment-picker';
import type { LocalFileAvailability } from '../platform/local-file-availability';
import type {
  WorkspaceCatalog,
  WorkspaceChanges,
  WorkspaceChangeSummary,
} from '../workspace/index';
import type { InputSuggestionQuery } from './input/execute-command';
import {
  DEFAULT_INPUT_POLICY,
  DOCUMENT_INPUT_POLICY,
  IMAGE_INPUT_POLICY,
} from './input/parse-message';
import { sessionMessagesToEstimateMessages } from './prepare-context';
import type {
  HostFailure,
  ReadCommittedRunRequest,
  ReadCommittedRunResult,
  ReadSessionRequest,
  ReadSessionResult,
  RunDto,
  SendUserInputRequest,
  SendUserInputResult,
  SessionConversationItemDto,
  SessionDto,
  SessionHost,
  SessionMessageConversationItemDto,
  SessionMessageDto,
  SessionReadDiagnosticDto,
  UserMessageDto,
  UserMessageSummaryDto,
  WorkspaceChangeSummaryDto,
} from './session-contracts';
import type {
  SessionAttachmentReader,
  SessionMessageAttachment,
} from './sessions/session-attachments';
import type { SessionBranchDrafts } from './sessions/session-branches';
import type { Session, SessionCatalog } from './sessions/session-catalog';
import type {
  SessionAssistantContent,
  SessionConversationItem,
  SessionHistory,
  SessionMessage,
  SessionMessageConversationItem,
  SessionMessageWithAttachments,
  SessionUserContent,
} from './sessions/session-history';
import { sessionMessageText } from './sessions/session-history';
import type { Coding, CodingRunSnapshot, SubmitCodingInputResult } from './submit-message';

export type SessionOperations = SessionHost;

/** Creates the concrete Product operations exposed through SessionHost. */
export function createSessionOperations(options: {
  settingsForWorkspace: (
    workspaceId?: string,
  ) => Pick<import('../settings/settings-store').Settings, 'readSettings'>;
  reader: SessionReader;
  coding: Pick<Coding, 'cancelInput' | 'submitInput'>;
  suggestions: InputSuggestionQuery;
  sessions: SessionCatalog;
  history: SessionHistory;
  attachments: SessionAttachmentReader;
  branches: SessionBranchDrafts;
  workspaces: Pick<WorkspaceCatalog, 'listWorkspaces'>;
  resolveModel: (
    request: {
      provider_id: string;
      model_id: string;
    },
    workspaceId?: string,
  ) => Promise<import('@megumi/ai').Model<import('@megumi/ai').Api> | undefined>;
  attachmentPicker?: AttachmentPicker;
  localFileAvailability?: LocalFileAvailability;
}): SessionOperations {
  return {
    async updateModelSelection(request) {
      const result = options.sessions.updateModelSelection({
        session_id: request.sessionId,
        model_selection: request.modelSelection,
      });
      if (result.status === 'failed')
        return { status: 'failed', failure: toFailure(result.failure) };
      return result.status === 'not_found'
        ? result
        : { status: 'updated', session: toSessionDto(result.session) };
    },
    sendUserInput: (request) => submitUserInput(options.coding, request),
    readSession: (request) => options.reader.readSession(request),
    readCommittedRun: (request) => options.reader.readCommittedRun(request),
    async createSession(request) {
      const read = options.settingsForWorkspace(request.projectId).readSettings();
      if (read.status === 'rejected') return { status: 'failed', failure: read.error };
      const result = options.sessions.createSession({
        workspace_id: request.projectId,
        title: request.title,
        model_selection: request.modelSelection ?? read.settings.config.general.lastSelectedModel,
      });
      return result.status === 'created'
        ? { status: 'created', session: toSessionDto(result.session) }
        : { status: 'failed', failure: toFailure(result.failure) };
    },
    async listSessions() {
      const sessions: Session[] = [];
      const workspaces = await options.workspaces.listWorkspaces();
      for (const workspace of workspaces.workspaces) {
        const result = options.sessions.listSessions({ workspace_id: workspace.workspace_id });
        if (result.status === 'failed')
          return { status: 'failed', failure: toFailure(result.failure) };
        sessions.push(...result.sessions);
      }
      return { status: 'ok', sessions: sessions.map(toSessionDto) };
    },
    async listUserMessagesByExecutionIds(request) {
      const result = options.history.listUserMessagesByExecutionIds({
        execution_ids: request.executionIds,
      });
      if (result.status === 'failed')
        return { status: 'failed', failure: toFailure(result.failure) };
      return {
        status: 'ok',
        messages: result.messages.map((message) =>
          toUserMessageSummary({ message, attachments: [] }),
        ),
      };
    },
    async cancelUserInput(request) {
      const accepted = options.coding.cancelInput(request.requestId);
      return {
        payload: {
          status: accepted ? 'cancellation_requested' : 'not_active',
          requestId: request.requestId,
        },
      };
    },
    createBranchDraft(request) {
      const result = options.branches.createBranchDraft({
        request_id: request.requestId,
        session_id: request.sessionId,
        source_message_id: request.messageId,
      });
      return {
        payload: {
          branchDraft: {
            branchMarkerId: result.branch_draft.branch_marker_id,
            sessionId: result.branch_draft.session_id,
            sourceMessageId: result.branch_draft.source_message_id,
            createdAt: result.branch_draft.created_at,
          },
        },
      };
    },
    cancelBranchDraft(request) {
      const result = options.branches.cancelBranchDraft({
        request_id: request.requestId,
        session_id: request.sessionId,
        branch_marker_id: request.branchMarkerId,
      });
      return result.status === 'cancelled'
        ? { payload: { cancelled: true } }
        : { payload: { cancelled: false, reason: result.reason } };
    },
    async getInputSuggestions(request) {
      return {
        suggestions: await options.suggestions.getInputSuggestions({
          draftInput: request.draftInput,
          ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
        }),
      };
    },
    async getContextUsage(request) {
      const history = options.history.getActiveHistory({ session_id: request.sessionId });
      if (history.status === 'failed') return { status: 'not_available' };
      const session = options.sessions.getSession({ session_id: request.sessionId });
      if (session.status !== 'found') return { status: 'not_available' };
      const configuration = options
        .settingsForWorkspace(session.session.workspace_id)
        .readSettings();
      if (configuration.status === 'rejected') return { status: 'not_available' };
      const model = await options.resolveModel(
        request.modelSelection,
        session.session.workspace_id,
      );
      if (!model) return { status: 'not_available' };
      const usage = estimateContextTokens(sessionMessagesToEstimateMessages(history.history));
      return {
        status: 'available',
        usage: {
          usedTokens: usage.tokens,
          totalTokens: model.contextWindow,
          remainingTokens: Math.max(0, model.contextWindow - usage.tokens),
          usedPercent: Math.min(100, Math.round((usage.tokens / model.contextWindow) * 100)),
          autoCompactPercent: Math.round(
            configuration.settings.config.context.compactionThresholdRatio * 100,
          ),
          accuracy: usage.usageTokens > 0 ? 'provider_reported' : 'estimated',
        },
      };
    },
    getInputCapabilities() {
      return {
        maxTextCharacters: DEFAULT_INPUT_POLICY.maxTextCharacters,
        allowedMediaTypes: [...IMAGE_INPUT_POLICY.allowedMediaTypes],
        maxImageCount: IMAGE_INPUT_POLICY.maxImageCount,
        maxImageBytes: IMAGE_INPUT_POLICY.maxImageBytes,
        maxTotalBytes: IMAGE_INPUT_POLICY.maxTotalBytes,
        allowedDocumentMediaTypes: [...DOCUMENT_INPUT_POLICY.allowedMediaTypes],
        maxDocumentCount: DOCUMENT_INPUT_POLICY.maxDocumentCount,
        maxDocumentBytes: DOCUMENT_INPUT_POLICY.maxDocumentBytes,
      };
    },
    async selectImages() {
      if (!options.attachmentPicker)
        return pickerFailure('image_picker_unavailable', 'Image picker is unavailable.');
      try {
        return await options.attachmentPicker.selectImages();
      } catch {
        return pickerFailure('image_picker_failed', 'Images could not be selected.');
      }
    },
    async selectDocuments() {
      if (!options.attachmentPicker)
        return pickerFailure('document_picker_unavailable', 'Document picker is unavailable.');
      try {
        return await options.attachmentPicker.selectDocuments();
      } catch {
        return pickerFailure('document_picker_failed', 'Documents could not be selected.');
      }
    },
    async readClipboardImage() {
      if (!options.attachmentPicker)
        return pickerFailure(
          'clipboard_image_unavailable',
          'Clipboard image input is unavailable.',
        );
      try {
        return await options.attachmentPicker.readClipboardImage();
      } catch (error) {
        return pickerFailure(
          'clipboard_image_failed',
          error instanceof Error ? error.message : 'The clipboard image could not be read.',
        );
      }
    },
    async readAttachmentImage(request) {
      const result = await options.attachments.readAttachmentContent({
        attachment_id: request.attachmentId,
      });
      return result.status === 'ok'
        ? {
            status: 'ok',
            dataUrl: `data:${result.content.media_type};base64,${Buffer.from(result.content.bytes).toString('base64')}`,
          }
        : { status: 'failed', failure: toFailure(result.failure) };
    },
    async getAttachmentFileStatus(request) {
      const result = options.attachments.getAttachment({ attachment_id: request.attachmentId });
      if (
        result.status !== 'found' ||
        result.attachment.type !== 'file' ||
        result.attachment.source_type !== 'local_file'
      )
        return { status: 'unavailable' };
      if (!options.localFileAvailability)
        return {
          status: 'failed',
          failure: {
            code: 'file_status_unavailable',
            message: 'Local file status is unavailable.',
          },
        };
      try {
        return (await options.localFileAvailability.exists(result.attachment.source_value))
          ? { status: 'available' }
          : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    },
  };
}

async function submitUserInput(
  coding: Pick<Coding, 'submitInput'>,
  request: SendUserInputRequest,
): Promise<SendUserInputResult> {
  const result = await coding.submitInput({
    ...(request.requestId ? { requestId: request.requestId } : {}),
    workspaceId: request.projectId,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.sessionTitle ? { sessionTitle: request.sessionTitle } : {}),
    ...(request.branchMarkerId ? { branchMarkerId: request.branchMarkerId } : {}),
    text: request.text,
    ...(request.skillSelection ? { skillSelection: request.skillSelection } : {}),
    ...(request.attachments ? { attachments: request.attachments } : {}),
    ...(request.modelSelection
      ? {
          modelSelection: {
            providerId: request.modelSelection.provider_id,
            modelId: request.modelSelection.model_id,
          },
        }
      : {}),
    ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
  });
  return mapConversationSubmission(result);
}

function mapConversationSubmission(result: SubmitCodingInputResult): SendUserInputResult {
  const session = result.session ? { session: toSessionDto(result.session) } : {};
  if (result.status === 'started') {
    if (result.userMessage.message.message_kind !== 'user_message') {
      throw new Error(
        'Conversation submission returned a non-user message for a started execution.',
      );
    }
    return {
      payload: {
        type: 'agent_run',
        session: toSessionDto(result.session),
        requestId: result.requestId,
        userMessageId: result.userMessage.message.message_id,
        userMessage: toUserMessageDto({
          message: result.userMessage.message,
          attachments: result.userMessage.attachments,
        }),
        run: toRunDto(result.run.snapshot),
        ...(result.branchCommit
          ? {
              branchCommit: {
                branchMarkerId: result.branchCommit.branchMarkerId,
                branch: {
                  type: 'branch',
                  branchId: result.branchCommit.branch.branchId,
                  sourceMessageId: result.branchCommit.branch.sourceMessageId,
                  targetMessageId: result.branchCommit.branch.targetMessageId,
                  createdAt: result.branchCommit.branch.createdAt,
                },
              },
            }
          : {}),
      },
    };
  }
  if (result.status === 'host_interaction_requested') {
    return {
      payload: {
        type: 'host_interaction_request',
        ...session,
        requestId: result.requestId,
        request: result.request,
      },
    };
  }
  if (result.status === 'completed') {
    return {
      payload: {
        type: 'completed',
        ...session,
        requestId: result.requestId,
        ...(result.message ? { message: result.message } : {}),
      },
    };
  }
  return {
    payload: {
      type: 'error',
      ...session,
      requestId: result.requestId,
      message: result.error.message,
    },
  };
}

function toUserMessageSummary(item: SessionMessageWithAttachments): UserMessageSummaryDto {
  const message = item.message;
  return {
    id: message.message_id,
    sessionId: message.session_id,
    ...(message.execution_id ? { executionId: message.execution_id } : {}),
    role:
      message.message_kind === 'user_message'
        ? 'user'
        : message.message_kind === 'tool_result'
          ? 'toolResult'
          : 'assistant',
    text: sessionMessageText(message),
    createdAt: message.created_at,
  };
}

function pickerFailure(code: string, message: string) {
  return { status: 'failed' as const, failure: { code, message } };
}

function toFailure(failure: { code: string; message: string; retryable?: boolean }): HostFailure {
  return {
    code: failure.code,
    message: failure.message,
    ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}),
  };
}

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
  readonly coding: Pick<Coding, 'getSessionRun'>;
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

        const activeRunResult = options.coding.getSessionRun(request.sessionId);
        const eventResult = options.events.read({ sessionId: request.sessionId });
        const executionIds = collectExecutionIds(
          conversationResult.conversation,
          activeRunResult?.runId,
        );
        const workspace = readWorkspaceChanges(options.workspaceChanges, executionIds);

        return {
          status: 'ok',
          session: toSessionDto(sessionResult.session),
          conversation: conversationResult.conversation.map(toConversationItemDto),
          ...(activeRunResult ? { activeRun: toRunDto(activeRunResult) } : {}),
          runtimeEvents: [...eventResult.events],
          eventRange: {
            ...(eventResult.firstSequence === undefined
              ? {}
              : { firstSequence: eventResult.firstSequence }),
            ...(eventResult.lastSequence === undefined
              ? {}
              : { lastSequence: eventResult.lastSequence }),
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
    modelSelection: session.model_selection,
    id: session.session_id,
    projectId: session.workspace_id,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

export function toRunDto(execution: CodingRunSnapshot): RunDto {
  return {
    requestId: execution.requestId,
    executionId: execution.runId,
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
    ...(message.skill_selection
      ? {
          skillSelection: {
            name: message.skill_selection.name,
            skillPath: message.skill_selection.skill_path,
          },
        }
      : {}),
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
    ...(item.error
      ? {
          error: {
            ...(item.error.code ? { code: item.error.code } : {}),
            message: item.error.message,
          },
        }
      : {}),
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
      ...(message.error
        ? {
            error: {
              code: message.error.code,
              message: message.error.message,
              ...(message.error.details ? { details: structuredClone(message.error.details) } : {}),
            },
          }
        : {}),
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

function modelFacts(
  message: Extract<
    SessionMessage,
    {
      message_kind: 'model_response' | 'assistant_reply';
    }
  >,
) {
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
    if (item.type === 'message' && item.message.execution_id)
      executionIds.add(item.message.execution_id);
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
      summaries.push(
        ...workspaceChanges
          .listChangeSummaries({ by: 'run', execution_id: executionId })
          .summaries.map(toWorkspaceChangeSummaryDto),
      );
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
