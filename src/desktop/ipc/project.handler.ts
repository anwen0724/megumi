// Handles project bridge operations using desktop host capabilities only.
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';

export async function handleProjectOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'project.list') throw unavailable(operation, 'src project repository is not implemented in this plan');
  if (operation === 'project.useExisting') throw unavailable(operation, 'src project repository is not implemented in this plan');
  if (operation === 'project.remove') throw unavailable(operation, 'src project repository is not implemented in this plan');
  if (operation === 'project.open') {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const explicitPath = typeof record.path === 'string' ? record.path : undefined;
    const selectedPath = explicitPath ?? (await context.hosts.dialogHost.openProjectDirectory(context.getMainWindow()));
    return selectedPath ? { path: selectedPath } : undefined;
  }
  return undefined;
}
