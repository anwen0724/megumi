// Resolves Desktop Main long-term memory file paths under Megumi Home.
// The path resolver is platform-aware and never hardcodes a user directory.
import { createHash } from 'node:crypto';
import path from 'node:path';

export interface MemoryRuntimePathInput {
  homePath: string;
  projectId?: string | null;
}

export interface MemoryRuntimeMirrorTarget {
  scope: 'user' | 'project';
  projectId?: string | null;
  mirrorId: string;
  filePath: string;
  title: string;
}

export function resolveUserMemoryMirrorTarget(input: { homePath: string }): MemoryRuntimeMirrorTarget {
  const homePath = path.resolve(input.homePath);
  return {
    scope: 'user',
    mirrorId: 'memory:user',
    filePath: path.join(homePath, 'memory', 'user.md'),
    title: 'User Memory',
  };
}

export function resolveProjectMemoryMirrorTarget(input: {
  homePath: string;
  projectId: string;
}): MemoryRuntimeMirrorTarget {
  const homePath = path.resolve(input.homePath);
  const projectKey = buildMemoryProjectKey(input.projectId);
  return {
    scope: 'project',
    projectId: input.projectId,
    mirrorId: `memory:project:${projectKey}`,
    filePath: path.join(homePath, 'memory', 'projects', projectKey, 'memory.md'),
    title: 'Project Memory',
  };
}

export function resolveMemoryDiagnosticsPath(input: {
  homePath: string;
  createdAt: string;
}): string {
  const date = input.createdAt.slice(0, 10);
  return path.join(path.resolve(input.homePath), 'memory', 'diagnostics', `${date}.jsonl`);
}

export function buildMemoryProjectKey(projectId: string): string {
  const slug = projectId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  const hash = createHash('sha256').update(projectId).digest('hex').slice(0, 12);
  return `${slug || 'project'}-${hash}`;
}
