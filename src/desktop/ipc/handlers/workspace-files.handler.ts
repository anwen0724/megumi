// Handles workspace file bridge operations that are desktop host actions.
import path from 'node:path';
import type { DesktopIpcContext } from '../ipc-context';
import { unavailable } from '../ipc-errors';
import { mapWorkspaceChangeSet } from '../../renderer-protocol/productization/productization';
import { unwrapRendererRuntimePayload } from '../runtime-request-payload';
import type { WorkspaceDirectoryEntry, WorkspaceFilesListData, WorkspaceFileOpenData } from '../../../shared/renderer-contracts/workspace';

export async function handleWorkspaceFilesOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'workspace.changes.list') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const runId = typeof record.runId === 'string' ? record.runId : undefined;
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : undefined;
    const changeSets = await context.runtime.workspaceRepository.listChangeSets({ runId, sessionId, workspaceId });
    return { changeSets: changeSets.map(mapWorkspaceChangeSet) };
  }
  if (operation === 'workspace.files.list') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const workspaceRoot = workspaceRootFor(context, operation);
    const directoryPath = typeof record.directoryPath === 'string'
      ? record.directoryPath
      : typeof record.path === 'string'
        ? record.path
        : '';
    const entries = await context.runtime.workspaceManager.listDirectory(directoryPath);
    return {
      workspaceRoot,
      directoryPath,
      entries: entries.map(mapWorkspaceDirectoryEntry),
    } satisfies WorkspaceFilesListData;
  }
  if (operation === 'workspace.files.open') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const workspaceRoot = workspaceRootFor(context, operation);
    const filePath = typeof record.filePath === 'string'
      ? record.filePath
      : typeof record.path === 'string'
        ? record.path
        : undefined;
    if (!filePath) throw unavailable(operation, 'filePath is required');
    await context.hosts.shellHost.openPath(resolveOpenPath(operation, workspaceRoot, filePath));
    return {
      workspaceRoot,
      filePath,
      opened: true,
    } satisfies WorkspaceFileOpenData;
  }
  return undefined;
}

function mapWorkspaceDirectoryEntry(entry: { name: string; path: unknown; kind: WorkspaceDirectoryEntry['kind'] }): WorkspaceDirectoryEntry {
  const relativePath = String(entry.path ?? '');
  return {
    name: entry.name,
    relativePath,
    path: relativePath,
    kind: entry.kind,
    depth: workspacePathDepth(relativePath),
  };
}

function workspacePathDepth(value: string): number {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  return normalized ? normalized.split('/').filter(Boolean).length : 0;
}

function workspaceRootFor(context: DesktopIpcContext, operation: string): string {
  const workspaceRoot = context.runtime?.workspaceManager.workspace.projectRoot;
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw unavailable(operation, 'desktop workspace root is not available');
  }
  return workspaceRoot;
}

function resolveOpenPath(operation: string, workspaceRoot: string, filePath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  if (!isInsideOrEqual(root, target)) {
    throw unavailable(operation, 'filePath must stay within the current workspace root');
  }
  return target;
}

function isInsideOrEqual(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
