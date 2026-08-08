/*
 * Owns Product Session operations outside the single input submission chain.
 * The submit chain itself is delegated to the dedicated InputSubmission owner.
 */
import type { Runs } from '@megumi/engine';
import { DEFAULT_INPUT_POLICY, DOCUMENT_INPUT_POLICY, IMAGE_INPUT_POLICY } from '@megumi/input';
import type { Session, SessionAttachmentReader, SessionBranchDrafts, SessionCatalog, SessionHistory, SessionMessageWithAttachments } from '@megumi/session';
import { sessionMessageText } from '@megumi/session';
import type { WorkspaceCatalog } from '@megumi/workspace';
import type { InputSubmission } from './input-submission';

import type {
  SessionHost,
  HostFailure,
  UserMessageSummaryDto,
} from '../../host/session-host';
import type { AttachmentPicker } from '../../host/capabilities/attachment-picker';
import type { LocalFileAvailability } from '../../host/capabilities/local-file-availability';
import type { InputSuggestionQuery } from './input-suggestions';
import type { SessionReader } from './session-reader';
import { toRunDto, toSessionDto } from './session-reader';

export type SessionOperations = SessionHost;

/** Creates the concrete Product operations exposed through SessionHost. */
export function createSessionOperations(options: {
  submission: InputSubmission;
  reader: SessionReader;
  runs: Pick<Runs, 'cancel'>;
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
    sendUserInput: (request) => options.submission.submit(request),
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
    async listUserMessagesByRunIds(request) {
      const result = options.history.listUserMessagesByRunIds({ run_ids: request.runIds });
      if (result.status === 'failed') return { status: 'failed', failure: toFailure(result.failure) };
      return {
        status: 'ok',
        messages: result.messages.map((message) => toUserMessageSummary({ message, attachments: [] })),
      };
    },
    async cancelUserInput(request) {
      const result = await options.runs.cancel({ runId: request.runId });
      if (result.status === 'cancellation_requested') return { payload: { status: 'cancellation_requested', run: toRunDto(result.run) } };
      if (result.status === 'already_cancelling') return { payload: { status: 'cancelling', run: toRunDto(result.run) } };
      if (result.status === 'not_found') return { payload: { status: 'not_found', runId: result.runId } };
      return { payload: { status: 'not_cancellable', run: toRunDto(result.run), reason: 'already_terminal' } };
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

function toUserMessageSummary(item: SessionMessageWithAttachments): UserMessageSummaryDto {
  const message = item.message;
  return { id: message.message_id, sessionId: message.session_id, ...(message.run_id ? { runId: message.run_id } : {}), role: message.message_kind === 'user_message' ? 'user' : message.message_kind === 'tool_result' ? 'toolResult' : 'assistant', text: sessionMessageText(message), createdAt: message.created_at };
}
function pickerFailure(code: string, message: string) { return { status: 'failed' as const, failure: { code, message } }; }
function toFailure(failure: { code: string; message: string; retryable?: boolean }): HostFailure {
  return { code: failure.code, message: failure.message, ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}) };
}
