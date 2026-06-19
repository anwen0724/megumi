// Handles project bridge operations by adapting renderer requests to desktop project infrastructure.
import path from 'node:path';
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';

export async function handleProjectOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'project.list') {
    const runtime = requireRuntime(context, operation);
    return { projects: runtime.projectRepository.listProjects() };
  }
  if (operation === 'project.open') {
    const runtime = requireRuntime(context, operation);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const projectId = typeof record.projectId === 'string' ? record.projectId : undefined;
    if (!projectId) throw unavailable(operation, 'projectId is required');
    const existing = runtime.projectRepository.getProject(projectId);
    if (!existing) throw unavailable(operation, `project was not found: ${projectId}`);
    const project = runtime.projectRepository.touchProject(projectId, new Date().toISOString()) ?? existing;
    if (!project) throw unavailable(operation, `project was not found: ${projectId}`);
    return { project };
  }
  if (operation === 'project.useExisting') {
    const runtime = requireRuntime(context, operation);
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const explicitPath = typeof record.path === 'string' ? record.path : undefined;
    const selectedPath = explicitPath ?? (await context.hosts.dialogHost.openProjectDirectory(context.getMainWindow()));
    if (!selectedPath) return { cancelled: true };
    const project = runtime.projectRepository.upsertFromPath({
      path: selectedPath,
      name: typeof record.name === 'string' ? record.name : path.basename(selectedPath),
      status: 'available',
      now: new Date().toISOString(),
    });
    return { cancelled: false, project };
  }
  if (operation === 'project.remove') {
    const runtime = requireRuntime(context, operation);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const projectId = typeof record.projectId === 'string' ? record.projectId : undefined;
    if (!projectId) throw unavailable(operation, 'projectId is required');
    return { projectId, removed: runtime.projectRepository.removeProject(projectId) };
  }
  return undefined;
}

function requireRuntime(context: DesktopIpcContext, operation: string) {
  if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
  return context.runtime;
}
