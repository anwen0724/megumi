// Handles session and message bridge operations by delegating Agent work to AppApi.
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';
import {
  createDesktopClientContext,
  mapRendererCancelToAppCancel,
  mapRendererMessageSendToAppStartRun,
} from '../mappers/app-request.mapper';
import { mapAppResponseToRenderer } from '../mappers/app-response.mapper';

export async function handleSessionOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'session.message.send') {
    const response = await context.appApi.startRun(
      mapRendererMessageSendToAppStartRun(payload),
      createDesktopClientContext(),
    );
    return mapAppResponseToRenderer(response);
  }
  if (operation === 'session.message.cancel') {
    const response = await context.appApi.cancelRun(
      mapRendererCancelToAppCancel(payload),
      createDesktopClientContext(),
    );
    return mapAppResponseToRenderer(response);
  }
  if (operation === 'session.list') {
    const runtime = requireRuntime(context, operation);
    return runtime.sessionRepository.listSessions();
  }
  if (operation === 'session.timeline.list') {
    const runtime = requireRuntime(context, operation);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    if (!sessionId) throw unavailable(operation, 'sessionId is required');
    return {
      sessionId,
      messages: runtime.sessionRepository.listMessagesForSession(sessionId),
      activePath: runtime.sessionRepository.getActivePath(sessionId),
      runs: runtime.sessionRepository.listRunRecords(sessionId),
    };
  }
  if (operation === 'session.branchDraft.create') throw unavailable(operation, 'src/session branch draft adapter is not implemented');
  if (operation === 'session.branchDraft.cancel') throw unavailable(operation, 'src/session branch draft adapter is not implemented');
  return undefined;
}

function requireRuntime(context: DesktopIpcContext, operation: string) {
  if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
  return context.runtime;
}
