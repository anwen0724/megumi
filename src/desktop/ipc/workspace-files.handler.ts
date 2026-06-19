// Handles workspace file bridge operations that are desktop host actions.
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';
import { mapWorkspaceChangeSet } from '../mappers/productization.mapper';

export async function handleWorkspaceFilesOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'workspace.changes.list') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const runId = typeof record.runId === 'string' ? record.runId : undefined;
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : undefined;
    const changeSets = await context.runtime.workspaceRepository.listChangeSets({ runId, sessionId, workspaceId });
    return { changeSets: changeSets.map(mapWorkspaceChangeSet) };
  }
  if (operation === 'workspace.files.list') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const path = typeof record.path === 'string' ? record.path : '';
    return context.runtime.workspaceManager.listDirectory(path);
  }
  if (operation === 'workspace.files.open') {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    if (typeof record.path === 'string') await context.hosts.shellHost.openPath(record.path);
    return { opened: typeof record.path === 'string' };
  }
  return undefined;
}
