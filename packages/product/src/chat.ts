/*
 * Owns Product Chat queries and interactions outside the single submit chain.
 * The submit chain itself is delegated to the dedicated InputSubmission owner.
 */
import type { Commands } from '@megumi/commands';
import type { ContextCapabilities } from '@megumi/context';
import type { Engine, Run } from '@megumi/engine';
import { DOCUMENT_INPUT_POLICY, IMAGE_INPUT_POLICY } from '@megumi/input';
import type { Session, SessionAttachmentReader, SessionBranchDrafts, SessionCatalog, SessionHistory, SessionMessageWithAttachments } from '@megumi/session';
import { sessionMessageText } from '@megumi/session';
import type { SessionTimelineQuery } from '@megumi/projections';
import type { WorkspaceCatalog } from '@megumi/workspace';
import type { InputSubmission } from './input-submission';
import type { ProductRunReadModel } from './run-read-model';
import type {
  ChatHost,
  ChatHostFailure,
  ChatRunUiDto,
  ChatSessionMessageUiDto,
  ChatSessionUiDto,
  HostCommandSuggestionResult,
  InputAttachmentPickerPort,
  LocalFileAvailabilityPort,
} from './host/chat-contract';

export type ProductChat = Omit<ChatHost, 'sendUserInput'> & {
  submit: InputSubmission['submit'];
};

export function createProductChat(options: {
  submission: InputSubmission;
  engine: Pick<Engine, 'cancelRun'>;
  commands: Pick<Commands, 'suggest'>;
  sessions: SessionCatalog;
  history: SessionHistory;
  attachments: SessionAttachmentReader;
  branches: SessionBranchDrafts;
  workspaces: Pick<WorkspaceCatalog, 'listWorkspaces'>;
  runs: ProductRunReadModel;
  timeline: SessionTimelineQuery;
  context: Pick<ContextCapabilities, 'getSessionUsage'>;
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
      if (result.status === 'cancellation_requested') return { payload: { status: 'cancellation_requested', run: toChatRun(result.run) }, events: result.events };
      if (result.status === 'already_cancelling') return { payload: { status: 'cancelling', run: toChatRun(result.run) } };
      if (result.status === 'not_found') return { payload: { status: 'not_found', runId: result.runId } };
      return { payload: { status: 'not_cancellable', run: toChatRun(result.run), reason: 'already_terminal' } };
    },
    createBranchDraft(request) {
      const result = options.branches.createBranchDraft({ request_id: request.requestId, session_id: request.sessionId, source_message_id: request.messageId, ...(request.runtimeContext ? { runtime_context: request.runtimeContext } : {}) });
      return {
        payload: { branchDraft: { branchMarkerId: result.branch_draft.branch_marker_id, sessionId: result.branch_draft.session_id, sourceMessageId: result.branch_draft.source_message_id, createdAt: result.branch_draft.created_at } },
        events: result.events,
      };
    },
    cancelBranchDraft(request) {
      const result = options.branches.cancelBranchDraft({ request_id: request.requestId, session_id: request.sessionId, branch_marker_id: request.branchMarkerId, ...(request.runtimeContext ? { runtime_context: request.runtimeContext } : {}) });
      return result.status === 'cancelled'
        ? { payload: { cancelled: true }, events: result.events }
        : { payload: { cancelled: false, reason: result.reason } };
    },
    async getCommandSuggestions(request) {
      return { suggestions: toCommandSuggestions(await options.commands.suggest({ draftInput: request.draft_input, ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}) })) };
    },
    async listRuns(request) { return { runs: options.runs.listRunsBySession(request.sessionId).map(toChatRun) }; },
    async listRunEvents(request) { return { events: [...options.runs.listEventsByRun(request.runId)] }; },
    async getSessionHydration(request) {
      const timeline = options.timeline.list({ workspaceId: request.projectId, sessionId: request.sessionId });
      const runs = options.runs.listRunsBySession(request.sessionId);
      return { messages: timeline.messages, diagnostics: timeline.diagnostics, runs: runs.map(toChatRun), runtimeEvents: runs.flatMap((run) => options.runs.listEventsByRun(run.runId)) };
    },
    async getContextUsage(request) {
      const result = options.context.getSessionUsage({ sessionId: request.sessionId });
      return result.status === 'available'
        ? { status: 'available', usage: { usedTokens: result.snapshot.usage.usedTokens, totalTokens: result.snapshot.usage.contextWindowTokens, remainingTokens: result.snapshot.usage.remainingTokens, usedPercent: Math.round(result.snapshot.usage.usedRatio * 100), autoCompactPercent: Math.round(result.snapshot.usage.compactionThresholdRatio * 100), accuracy: result.snapshot.accuracy } }
        : { status: 'not_available' };
    },
    getInputCapabilities() {
      return { allowedMediaTypes: [...IMAGE_INPUT_POLICY.allowedMediaTypes], maxImageCount: IMAGE_INPUT_POLICY.maxImageCount, maxImageBytes: IMAGE_INPUT_POLICY.maxImageBytes, maxTotalBytes: IMAGE_INPUT_POLICY.maxTotalBytes, allowedDocumentMediaTypes: [...DOCUMENT_INPUT_POLICY.allowedMediaTypes], maxDocumentCount: DOCUMENT_INPUT_POLICY.maxDocumentCount, maxDocumentBytes: DOCUMENT_INPUT_POLICY.maxDocumentBytes };
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
function toChatRun(run: Run): ChatRunUiDto {
  return { runId: run.runId, sessionId: run.sessionId, status: run.status, createdAt: run.createdAt, ...(run.completedAt ? { completedAt: run.completedAt } : {}) };
}
function toCommandSuggestions(result: Awaited<ReturnType<Commands['suggest']>>): HostCommandSuggestionResult {
  if (result.type === 'inactive') return result;
  return { type: 'suggestions', draft_input: result.draftInput, command_prefix: result.commandPrefix, groups: result.groups.map((group) => ({ id: group.id, label: group.label, items: group.items.map((item) => ({ name: item.name, ...(item.aliases ? { aliases: [...item.aliases] } : {}), description: item.description, ...(item.argumentHint ? { argument_hint: item.argumentHint } : {}), source: item.source, ...(item.sourceBadge ? { source_badge: item.sourceBadge } : {}), ...(item.display ? { display: item.display } : {}), match: item.match, displayInput: `/${item.display?.primary ?? item.name} `, submitInput: item.completion.replacementInput, ...(item.completion.selection ? { selection: item.completion.selection } : {}) })) })) };
}
function pickerFailure(code: string, message: string) { return { status: 'failed' as const, failure: { code, message } }; }
function toFailure(failure: { code: string; message: string; retryable?: boolean }): ChatHostFailure {
  return { code: failure.code, message: failure.message, ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}) };
}
