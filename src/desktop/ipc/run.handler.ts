// Handles run query bridge operations for renderer hydration.
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';
import { mapRuntimeEventHistory } from '../mappers/history.mapper';

export async function handleRunOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'run.listBySession') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    if (!sessionId) throw unavailable(operation, 'sessionId is required');
    return context.runtime.sessionRepository.listRunRecords(sessionId);
  }
  if (operation === 'run.events.list') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const runId = typeof record.runId === 'string' ? record.runId : undefined;
    if (!runId) throw unavailable(operation, 'runId is required');
    return { events: context.runtime.runtimeEventRepository.listEventsByRun(runId).map(mapRuntimeEventHistory) };
  }
  return undefined;
}
