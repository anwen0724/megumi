// Handles run query bridge operations for renderer hydration.
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';

export async function handleRunOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'run.listBySession') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    if (!sessionId) throw unavailable(operation, 'sessionId is required');
    return context.runtime.sessionRepository.listRunRecords(sessionId);
  }
  if (operation === 'run.events.list') throw unavailable(operation, 'durable runtime event repository is not implemented in this plan');
  return undefined;
}
