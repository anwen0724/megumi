import path from 'node:path';

export interface WorkspaceRootSessionSource {
  listSessions(): Array<{ workspacePath?: string | null }>;
}

export interface WorkspaceRootProjectSource {
  listAuthorizedWorkspaceRoots(): string[];
}

export interface CreateWorkspaceRootAuthorizerOptions {
  staticRoots?: readonly string[];
  sessionSource?: WorkspaceRootSessionSource;
  projectSource?: WorkspaceRootProjectSource;
}

export function createWorkspaceRootAuthorizer(
  options: CreateWorkspaceRootAuthorizerOptions,
): (workspaceRoot: string) => boolean {
  const staticRootKeys = new Set((options.staticRoots ?? []).map(toWorkspaceRootKey));

  return (workspaceRoot) => {
    const requestedRootKey = toWorkspaceRootKey(workspaceRoot);

    if (staticRootKeys.has(requestedRootKey)) {
      return true;
    }

    const hasSessionRoot = (options.sessionSource?.listSessions() ?? []).some((session) =>
      session.workspacePath ? toWorkspaceRootKey(session.workspacePath) === requestedRootKey : false
    );

    if (hasSessionRoot) {
      return true;
    }

    return (options.projectSource?.listAuthorizedWorkspaceRoots() ?? []).some(
      (projectRoot) => toWorkspaceRootKey(projectRoot) === requestedRootKey,
    );
  };
}

function toWorkspaceRootKey(workspaceRoot: string): string {
  const normalized = path.resolve(workspaceRoot);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
