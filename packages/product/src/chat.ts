/*
 * Owns Product Chat queries and interactions outside the single submit chain.
 * The submit chain itself is delegated to the dedicated InputSubmission owner.
 */
import type { ContextCapabilities } from '@megumi/context';
import type { Engine, Run } from '@megumi/engine';
import { DEFAULT_INPUT_POLICY, DOCUMENT_INPUT_POLICY, IMAGE_INPUT_POLICY } from '@megumi/input';
import type { Session, SessionAttachmentReader, SessionBranchDrafts, SessionCatalog, SessionHistory, SessionMessageWithAttachments } from '@megumi/session';
import { sessionMessageText } from '@megumi/session';
import type { ProjectedRun, RunProjection, SessionTimelineQuery } from '@megumi/projections';
import type { WorkspaceCatalog } from '@megumi/workspace';
import type { InputSubmission } from './input-submission';

import type {
  ChatHost,
  ChatHostFailure,
  ChatRunUiDto,
  ChatSessionMessageUiDto,
  ChatSessionUiDto,
  InputAttachmentPickerPort,
  LocalFileAvailabilityPort,
} from './host/chat-contract';
import type { InputSuggestionQuery } from './input-suggestions';

export type ProductChat = Omit<ChatHost, 'sendUserInput'> & {
  submit: InputSubmission['submit'];
};

export function createProductChat(options: {
  submission: InputSubmission;
  engine: Pick<Engine, 'cancelRun'>;
  suggestions: InputSuggestionQuery;
  sessions: SessionCatalog;
  history: SessionHistory;
  attachments: SessionAttachmentReader;
  branches: SessionBranchDrafts;
  workspaces: Pick<WorkspaceCatalog, 'listWorkspaces'>;
  runs: RunProjection;
  timeline: SessionTimelineQuery;
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
  attachmentPicker?: InputAttachmentPickerPort;
  localFileAvailability?: LocalFileAvailabilityPort;
}): ProductChat {
  return {
    submit: (request) => options.submission.submit(request),
    async createSession(request) {
      const result = options.sessions.createSession({ workspace_id: request.projectId, ...(request.title ? { title: request.title } : {}) });
      return result.status === 'created'
        ? { status: 'created', session: toChatSession(result.session) }
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
      return { status: 'ok', sessions: sessions.map(toChatSession) };
    },
    async listMessages(request) {
      if ('runIds' in request) {
        const result = options.history.listUserMessagesByRunIds({ run_ids: request.runIds });
        if (result.status === 'failed') return { status: 'failed', failure: toFailure(result.failure) };
        return { status: 'ok', messages: result.messages.map((message) => toChatMessage({ message, attachments: [] })) };
      }
      const result = options.history.getActiveConversationHistory({ session_id: request.sessionId });
      return result.status === 'failed'
        ? { status: 'failed', failure: toFailure(result.failure) }
        : { status: 'ok', messages: result.messages.map(toChatMessage) };
    },
    async listTimeline(request) {
      return options.timeline.list({ workspaceId: request.projectId, sessionId: request.sessionId, ...(request.runId ? { runId: request.runId } : {}) });
    },
    async cancelUserInput(request) {
      const result = await options.engine.cancelRun({ runId: request.runId });
      if (result.status === 'cancellation_requested') return { payload: { status: 'cancellation_requested', run: toChatRun(result.run) } };
      if (result.status === 'already_cancelling') return { payload: { status: 'cancelling', run: toChatRun(result.run) } };
      if (result.status === 'not_found') return { payload: { status: 'not_found', runId: result.runId } };
      return { payload: { status: 'not_cancellable', run: toChatRun(result.run), reason: 'already_terminal' } };
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
    async listRuns(request) { return { runs: options.runs.listRuns({ sessionId: request.sessionId }).map(toChatRun) }; },
    async listRunEvents(request) { return { events: [...options.runs.listEvents({ runId: request.runId })] }; },
    async getSessionHydration(request) {
      const timeline = options.timeline.list({ workspaceId: request.projectId, sessionId: request.sessionId });
      const runs = options.runs.listRuns({ sessionId: request.sessionId });
      return { messages: timeline.messages, diagnostics: timeline.diagnostics, runs: runs.map(toChatRun), runtimeEvents: runs.flatMap((run) => options.runs.listEvents({ runId: run.runId })) };
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

function toChatSession(session: Session): ChatSessionUiDto {
  return { id: session.session_id, projectId: session.workspace_id, title: session.title, status: session.status, createdAt: session.created_at, updatedAt: session.updated_at };
}
function toChatMessage(item: SessionMessageWithAttachments): ChatSessionMessageUiDto {
  const message = item.message;
  return { id: message.message_id, sessionId: message.session_id, ...(message.run_id ? { runId: message.run_id } : {}), role: message.message_kind === 'user_message' ? 'user' : message.message_kind === 'tool_result' ? 'toolResult' : 'assistant', text: sessionMessageText(message), createdAt: message.created_at };
}
function toChatRun(run: Run | ProjectedRun): ChatRunUiDto {
  return { runId: run.runId, sessionId: run.sessionId, status: run.status, createdAt: run.createdAt, ...(run.completedAt ? { completedAt: run.completedAt } : {}) };
}
function pickerFailure(code: string, message: string) { return { status: 'failed' as const, failure: { code, message } }; }
function toFailure(failure: { code: string; message: string; retryable?: boolean }): ChatHostFailure {
  return { code: failure.code, message: failure.message, ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}) };
}
