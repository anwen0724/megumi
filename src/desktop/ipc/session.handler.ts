// Handles session and message bridge operations by delegating Agent work to AppApi.
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';
import {
  createDesktopClientContext,
  mapRendererCancelToAppCancel,
  mapRendererMessageSendToAppStartRun,
} from '../mappers/app-request.mapper';
import { mapAppResponseToRenderer } from '../mappers/app-response.mapper';
import {
  mapBranchDraft,
  mapRunToRendererSummary,
  mapSessionToRendererSummary,
  mapSourceEntry,
  mapTimelineHydration,
} from '../mappers/history.mapper';
import { unwrapRendererRuntimePayload } from './runtime-request-payload';

export async function handleSessionOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'session.message.send') {
    const response = await context.appApi.startRun(
      mapRendererMessageSendToAppStartRun(payload),
      createDesktopClientContext(payload),
    );
    return mapAppResponseToRenderer(response, payload);
  }
  if (operation === 'session.message.cancel') {
    const cancelPayload = unwrapRendererRuntimePayload(payload);
    const response = await context.appApi.cancelRun(
      mapRendererCancelToAppCancel(cancelPayload),
      createDesktopClientContext(),
    );
    return mapAppResponseToRenderer(response);
  }
  if (operation === 'session.list') {
    const runtime = requireRuntime(context, operation);
    return { sessions: runtime.sessionRepository.listSessions().map(mapSessionToRendererSummary) };
  }
  if (operation === 'session.timeline.list') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    if (!sessionId) throw unavailable(operation, 'sessionId is required');
    const session = runtime.sessionRepository.getSession(sessionId);
    const projectId = typeof record.projectId === 'string'
      ? record.projectId
      : session?.workspaceId ?? 'local';
    const committed = runtime.timelineMessageRepository.listCommittedMessagesBySession({ projectId, sessionId });
    if (committed.messages.length > 0 || committed.diagnostics.length > 0) {
      return {
        sessionId,
        messages: committed.messages,
        runs: runtime.sessionRepository.listRunRecords(sessionId).map(mapRunToRendererSummary),
        activePath: runtime.sessionRepository.getActivePath(sessionId).map(mapSourceEntry),
        diagnostics: committed.diagnostics,
      };
    }
    const runs = runtime.sessionRepository.listRunRecords(sessionId);
    return mapTimelineHydration({
      projectId,
      sessionId,
      messages: runtime.sessionRepository.listMessagesForSession(sessionId),
      runs,
      activePath: runtime.sessionRepository.getActivePath(sessionId),
      runtimeEvents: runs.flatMap((run) => runtime.runtimeEventRepository.listEventsByRun(run.id)),
    });
  }
  if (operation === 'session.branchDraft.create') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    const messageId = typeof record.messageId === 'string' ? record.messageId : undefined;
    const intent = record.intent === 'branch' || record.intent === 'rerun' ? record.intent : undefined;
    if (!sessionId) throw unavailable(operation, 'sessionId is required');
    if (!messageId) throw unavailable(operation, 'messageId is required');
    if (!intent) throw unavailable(operation, 'intent must be branch or rerun');
    const activePath = runtime.sessionRepository.getActivePath(sessionId);
    const sourceEntry = activePath.find((entry) => entry.kind === 'message' && entry.ref.type === 'message' && String(entry.ref.messageId) === messageId);
    if (!sourceEntry) throw unavailable(operation, `message is not on the active path: ${messageId}`);
    const sourceMessage = runtime.sessionRepository.getMessage(messageId);
    if (!sourceMessage) throw unavailable(operation, `message was not found: ${messageId}`);
    const previousActiveLeaf = runtime.sessionRepository.getActiveLeaf(sessionId);
    const { marker } = runtime.sessionManager.createBranch({
      idSeed: `${sessionId}-${messageId}-${intent}`,
      sessionId,
      fromSourceEntryId: sourceEntry.id,
      label: intent === 'rerun' ? 'Rerun from message' : 'Branch from message',
      metadata: {
        intent,
        sourceMessageId: messageId,
        ...(previousActiveLeaf ? { previousActiveLeafSourceEntryId: previousActiveLeaf.id } : {}),
      },
    });
    return { branchDraft: mapBranchDraft({ marker, sourceMessage, intent }) };
  }
  if (operation === 'session.branchDraft.cancel') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    const branchMarkerId = typeof record.branchMarkerId === 'string' ? record.branchMarkerId : undefined;
    if (!sessionId) throw unavailable(operation, 'sessionId is required');
    if (!branchMarkerId) throw unavailable(operation, 'branchMarkerId is required');
    const marker = runtime.sessionRepository.listBranchMarkers(sessionId).find((item) => item.id === branchMarkerId);
    if (!marker) return { cancelled: false, reason: 'branch_marker_not_found' };
    const activeLeaf = runtime.sessionRepository.getActiveLeaf(sessionId);
    if (!activeLeaf || activeLeaf.id !== marker.sourceEntryId) {
      return { cancelled: false, reason: 'branch_has_new_sources' };
    }
    const previousActiveLeafSourceEntryId = typeof marker.metadata?.previousActiveLeafSourceEntryId === 'string'
      ? marker.metadata.previousActiveLeafSourceEntryId
      : undefined;
    if (!previousActiveLeafSourceEntryId) {
      return { cancelled: false, reason: 'previous_active_leaf_not_found' };
    }
    const previousActiveLeaf = runtime.sessionRepository.getSourceEntry(previousActiveLeafSourceEntryId);
    if (!previousActiveLeaf) {
      return { cancelled: false, reason: 'previous_active_leaf_not_found' };
    }
    runtime.sessionRepository.setActiveLeaf(sessionId, previousActiveLeaf.id);
    const occurredAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
    runtime.eventBus.publish({
      type: 'session.branch_draft.cancelled',
      sessionId,
      occurredAt,
      payload: {
        branchMarkerId,
        restoredLeafSourceEntryId: previousActiveLeaf.id,
        reason: 'branch_cancelled',
      },
    });
    return { cancelled: true };
  }
  return undefined;
}

function requireRuntime(context: DesktopIpcContext, operation: string) {
  if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
  return context.runtime;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
