// Handles project bridge operations by adapting renderer requests to desktop project infrastructure.
import path from 'node:path';
import type { DesktopIpcContext } from '../ipc-context';
import { unavailable } from '../ipc-errors';
import { unwrapRendererRuntimePayload } from '../runtime-request-payload';

interface DesktopProjectRecord {
  id?: string;
  projectId?: string;
  name: string;
  path?: string;
  repoPath?: string;
  status: 'available' | 'missing';
  createdAt: string;
  lastOpenedAt: string;
}

export async function handleProjectOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'project.list') {
    const runtime = requireRuntime(context, operation);
    return { projects: runtime.projectRepository.listProjects().map(toRendererProjectRecord) };
  }
  if (operation === 'project.open') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const projectId = typeof record.projectId === 'string' ? record.projectId : undefined;
    if (!projectId) throw unavailable(operation, 'projectId is required');
    const existing = runtime.projectRepository.getProject(projectId);
    if (!existing) throw unavailable(operation, `project was not found: ${projectId}`);
    const project = runtime.projectRepository.touchProject(projectId, new Date().toISOString()) ?? existing;
    if (!project) throw unavailable(operation, `project was not found: ${projectId}`);
    return { project: toRendererProjectRecord(project) };
  }
  if (operation === 'project.useExisting') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const explicitPath = typeof record.path === 'string' ? record.path : undefined;
    const selectedPath = explicitPath ?? (await context.hosts.dialogHost.openProjectDirectory(context.getMainWindow()));
    if (!selectedPath) return { cancelled: true };
    const project = runtime.projectRepository.upsertFromPath({
      path: selectedPath,
      name: typeof record.name === 'string' ? record.name : path.basename(selectedPath),
      status: 'available',
      now: new Date().toISOString(),
    });
    return { cancelled: false, project: toRendererProjectRecord(project) };
  }
  if (operation === 'project.remove') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function toRendererProjectRecord(project: DesktopProjectRecord) {
  const projectId = project.projectId ?? project.id;
  const repoPath = project.repoPath ?? project.path;
  if (!projectId) throw unavailable('project', 'project id is missing from repository record');
  if (!repoPath) throw unavailable('project', 'project path is missing from repository record');
  return {
    projectId,
    name: project.name,
    repoPath,
    repoPathKey: createRepoPathKey(repoPath),
    status: project.status,
    createdAt: project.createdAt,
    lastOpenedAt: project.lastOpenedAt,
  };
}

function createRepoPathKey(repoPath: string): string {
  return process.platform === 'win32' ? repoPath.toLowerCase() : path.resolve(repoPath);
}
