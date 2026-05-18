import path from 'node:path';
import type { Session } from '@megumi/shared/session-run-contracts';

export interface WorkspaceRootSessionSource {
  listSessions(): Session[];
}

export interface CreateWorkspaceRootAuthorizerOptions {
  staticRoots?: readonly string[];
  sessionSource?: WorkspaceRootSessionSource;
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

    return (options.sessionSource?.listSessions() ?? []).some((session) =>
      session.workspacePath ? toWorkspaceRootKey(session.workspacePath) === requestedRootKey : false
    );
  };
}

function toWorkspaceRootKey(workspaceRoot: string): string {
  const normalized = path.resolve(workspaceRoot);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
