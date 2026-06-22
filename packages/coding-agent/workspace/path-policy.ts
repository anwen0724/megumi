// Workspace path helpers shared by product workspace services without importing desktop host executors.
import { classifyProjectPath } from '../permissions/project-boundary-policy';

export function normalizeWorkspaceSlash(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function inputRecord(input: { toolName: string; input?: unknown }): Record<string, unknown> {
  if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
    throw new Error(`Tool input must be an object: ${input.toolName}`);
  }
  return input.input as Record<string, unknown>;
}

export function resolveProjectPath(
  context: { projectRoot: string },
  targetPath: string,
): { absolutePath: string; relativePath: string; protected: boolean; sensitive: boolean } {
  const classification = classifyProjectPath({
    projectRoot: context.projectRoot,
    targetPath,
  });

  if (!classification.insideProject) {
    throw new Error(`Project path is outside the project: ${targetPath}`);
  }

  return {
    absolutePath: classification.absolutePath,
    relativePath: classification.relativePath || '.',
    protected: classification.protected,
    sensitive: classification.sensitive,
  };
}

export function assertOrdinaryProjectPath(
  context: { projectRoot: string },
  targetPath: string,
): { absolutePath: string; relativePath: string } {
  const resolved = resolveProjectPath(context, targetPath);
  if (resolved.protected) {
    throw new Error(`Project path is protected: ${resolved.relativePath}`);
  }
  if (resolved.sensitive) {
    throw new Error(`Project path is sensitive: ${resolved.relativePath}`);
  }
  return resolved;
}
