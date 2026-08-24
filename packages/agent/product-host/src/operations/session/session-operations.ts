/*
 * Adapts Product Session Host DTOs to their owning capability interfaces and
 * projects domain results back to stable Host DTOs.
 */
import type {
  DiscoveryAgent,
  SubmitConversationInputResult,
} from '@megumi/discovery';
import { DEFAULT_INPUT_POLICY, DOCUMENT_INPUT_POLICY, IMAGE_INPUT_POLICY } from '@megumi/input';
import type { Session, SessionAttachmentReader, SessionBranchDrafts, SessionCatalog, SessionHistory, SessionMessageWithAttachments } from '@megumi/session';
import { sessionMessageText } from '@megumi/session';
import type { WorkspaceCatalog } from '@megumi/workspace';
import type {
  SessionHost,
  HostFailure,
  SendUserInputRequest,
  SendUserInputResult,
  UserMessageSummaryDto,
} from '../../host/session-host';
import type { AttachmentPicker } from '../../host/capabilities/attachment-picker';
import type { LocalFileAvailability } from '../../host/capabilities/local-file-availability';
import type { InputSuggestionQuery } from './input-suggestions';
import type { SessionReader } from './session-reader';
import { toRunDto, toSessionDto, toUserMessageDto } from './session-reader';

export type SessionOperations = SessionHost;

/** Creates the concrete Product operations exposed through SessionHost. */
export function createSessionOperations(options: {
  reader: SessionReader;
  discoveryAgent: Pick<DiscoveryAgent, 'cancel' | 'submitConversationInput'>;
  suggestions: InputSuggestionQuery;
  sessions: SessionCatalog;
  history: SessionHistory;
  attachments: SessionAttachmentReader;
  branches: SessionBranchDrafts;
  workspaces: Pick<WorkspaceCatalog, 'listWorkspaces'>;
  context: {
    deriveUsage(
      history: readonly import('@megumi/session').SessionHistoryItem[],
      model: import('@megumi/ai').Model<import('@megumi/ai').Api>,
    ): import('@megumi/context').DerivedContextUsage;
    autoCompactPercent: number;
  };
  resolveModel: (request: {
    provider_id: string;
    model_id: string;
  }) => Promise<import('@megumi/ai').Model<import('@megumi/ai').Api> | undefined>;
  attachmentPicker?: AttachmentPicker;
  localFileAvailability?: LocalFileAvailability;
}): SessionOperations {
  return {
    sendUserInput: (request) => submitUserInput(options.discoveryAgent, request),
    readSession: (request) => options.reader.readSession(request),
    readCommittedRun: (request) => options.reader.readCommittedRun(request),
    async createSession(request) {
      const result = options.sessions.createSession({ workspace_id: request.projectId, ...(request.title ? { title: request.title } : {}) });
      return result.status === 'created'
        ? { status: 'created', session: toSessionDto(result.session) }
        : { status: 'failed', failure: toFailure(result.failure) };
    },
    async listSessions() {
      const sessions: Session[] = [];
      const workspaces = await options.workspaces.listWorkspaces();
      for (const workspace of workspaces.workspaces) {
        const result = options.sessions.listSessions({ workspace_id: workspace.workspace_id });
        if (result.status === 'failed') return { status: 'failed', failure: toFailure(result.failure) };
        sessions.push(...result.sessions);
      }
      return { status: 'ok', sessions: sessions.map(toSessionDto) };
    },
    async listUserMessagesByExecutionIds(request) {
      const result = options.history.listUserMessagesByExecutionIds({ execution_ids: request.executionIds });
      if (result.status === 'failed') return { status: 'failed', failure: toFailure(result.failure) };
      return {
        status: 'ok',
        messages: result.messages.map((message) => toUserMessageSummary({ message, attachments: [] })),
      };
    },
    async cancelUserInput(request) {
      const result = await options.discoveryAgent.cancel({ executionId: request.executionId });
      if (result.status === 'cancellation_requested') return { payload: { status: 'cancellation_requested', run: toRunDto(result.execution) } };
      if (result.status === 'already_cancelling') return { payload: { status: 'cancelling', run: toRunDto(result.execution) } };
      if (result.status === 'not_found') return { payload: { status: 'not_found', executionId: result.executionId } };
      return { payload: { status: 'not_cancellable', run: toRunDto(result.execution), reason: 'already_terminal' } };
    },
    createBranchDraft(request) {
      const result = options.branches.createBranchDraft({ request_id: request.requestId, session_id: request.sessionId, source_message_id: request.messageId });
      return {
        payload: { branchDraft: { branchMarkerId: result.branch_draft.branch_marker_id, sessionId: result.branch_draft.session_id, sourceMessageId: result.branch_draft.source_message_id, createdAt: result.branch_draft.created_at } },
      };
    },
    cancelBranchDraft(request) {
      const result = options.branches.cancelBranchDraft({ request_id: request.requestId, session_id: request.sessionId, branch_marker_id: request.branchMarkerId });
      return result.status === 'cancelled'
        ? { payload: { cancelled: true } }
        : { payload: { cancelled: false, reason: result.reason } };
    },
    async getInputSuggestions(request) {
      return { suggestions: await options.suggestions.getInputSuggestions({ draftInput: request.draftInput, ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}) }) };
    },
    async getContextUsage(request) {
      const history = options.history.getActiveHistory({ session_id: request.sessionId });
      if (history.status === 'failed') return { status: 'not_available' };
      const model = await options.resolveModel(request.modelSelection);
      if (!model) return { status: 'not_available' };
      const usage = options.context.deriveUsage(history.history, model);
      return {
        status: 'available',
        usage: {
          usedTokens: usage.totalTokens,
          totalTokens: usage.contextWindowTokens,
          remainingTokens: Math.max(0, usage.contextWindowTokens - usage.totalTokens),
          usedPercent: Math.min(100, Math.round(usage.usedRatio * 100)),
          autoCompactPercent: options.context.autoCompactPercent,
          accuracy: usage.accuracy,
        },
      };
    },
    getInputCapabilities() {
      return { maxTextCharacters: DEFAULT_INPUT_POLICY.maxTextCharacters, allowedMediaTypes: [...IMAGE_INPUT_POLICY.allowedMediaTypes], maxImageCount: IMAGE_INPUT_POLICY.maxImageCount, maxImageBytes: IMAGE_INPUT_POLICY.maxImageBytes, maxTotalBytes: IMAGE_INPUT_POLICY.maxTotalBytes, allowedDocumentMediaTypes: [...DOCUMENT_INPUT_POLICY.allowedMediaTypes], maxDocumentCount: DOCUMENT_INPUT_POLICY.maxDocumentCount, maxDocumentBytes: DOCUMENT_INPUT_POLICY.maxDocumentBytes };
    },
    async selectImages() {
      if (!options.attachmentPicker) return pickerFailure('image_picker_unavailable', 'Image picker is unavailable.');
      try { return await options.attachmentPicker.selectImages(); } catch { return pickerFailure('image_picker_failed', 'Images could not be selected.'); }
    },
    async selectDocuments() {
      if (!options.attachmentPicker) return pickerFailure('document_picker_unavailable', 'Document picker is unavailable.');
      try { return await options.attachmentPicker.selectDocuments(); } catch { return pickerFailure('document_picker_failed', 'Documents could not be selected.'); }
    },
    async readClipboardImage() {
      if (!options.attachmentPicker) return pickerFailure('clipboard_image_unavailable', 'Clipboard image input is unavailable.');
      try { return await options.attachmentPicker.readClipboardImage(); } catch (error) { return pickerFailure('clipboard_image_failed', error instanceof Error ? error.message : 'The clipboard image could not be read.'); }
    },
    async readAttachmentImage(request) {
      const result = await options.attachments.readAttachmentContent({ attachment_id: request.attachmentId });
      return result.status === 'ok'
        ? { status: 'ok', dataUrl: `data:${result.content.media_type};base64,${Buffer.from(result.content.bytes).toString('base64')}` }
        : { status: 'failed', failure: toFailure(result.failure) };
    },
    async getAttachmentFileStatus(request) {
      const result = options.attachments.getAttachment({ attachment_id: request.attachmentId });
      if (result.status !== 'found' || result.attachment.type !== 'file' || result.attachment.source_type !== 'local_file') return { status: 'unavailable' };
      if (!options.localFileAvailability) return { status: 'failed', failure: { code: 'file_status_unavailable', message: 'Local file status is unavailable.' } };
      try { return await options.localFileAvailability.exists(result.attachment.source_value) ? { status: 'available' } : { status: 'unavailable' }; }
      catch { return { status: 'unavailable' }; }
    },
  };
}

async function submitUserInput(
  discoveryAgent: Pick<DiscoveryAgent, 'submitConversationInput'>,
  request: SendUserInputRequest,
): Promise<SendUserInputResult> {
  const result = await discoveryAgent.submitConversationInput({
    ...(request.requestId ? { requestId: request.requestId } : {}),
    workspaceId: request.projectId,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.recommendationId ? { recommendationId: request.recommendationId } : {}),
    ...(request.sessionTitle ? { sessionTitle: request.sessionTitle } : {}),
    ...(request.branchMarkerId ? { branchMarkerId: request.branchMarkerId } : {}),
    text: request.text,
    ...(request.skillSelection ? { skillSelection: request.skillSelection } : {}),
    ...(request.attachments ? { attachments: request.attachments } : {}),
    modelSelection: {
      providerId: request.modelSelection.provider_id,
      modelId: request.modelSelection.model_id,
    },
    ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
  });
  return mapConversationSubmission(result);
}

function mapConversationSubmission(result: SubmitConversationInputResult): SendUserInputResult {
  const session = result.session ? { session: toSessionDto(result.session) } : {};
  if (result.status === 'agent_started') {
    if (result.userMessage.message.message_kind !== 'user_message') {
      throw new Error('Discovery Agent returned a non-user message for a started execution.');
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
        run: toRunDto(result.execution),
        ...(result.branchCommit ? {
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
        } : {}),
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
      message: result.failure.message,
    },
  };
}

function toUserMessageSummary(item: SessionMessageWithAttachments): UserMessageSummaryDto {
  const message = item.message;
  return { id: message.message_id, sessionId: message.session_id, ...(message.execution_id ? { executionId: message.execution_id } : {}), role: message.message_kind === 'user_message' ? 'user' : message.message_kind === 'tool_result' ? 'toolResult' : 'assistant', text: sessionMessageText(message), createdAt: message.created_at };
}
function pickerFailure(code: string, message: string) { return { status: 'failed' as const, failure: { code, message } }; }
function toFailure(failure: { code: string; message: string; retryable?: boolean }): HostFailure {
  return { code: failure.code, message: failure.message, ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}) };
}
