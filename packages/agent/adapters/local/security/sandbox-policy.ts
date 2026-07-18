// Resolves Desktop Main workspace paths while rejecting paths outside the workspace root.
import path from 'node:path';

export class PathSandboxViolationError extends Error {
  constructor(
    public readonly workspaceRoot: string,
    public readonly requestedPath: string,
  ) {
    super('Path escapes workspace root');
    this.name = 'PathSandboxViolationError';
  }
}

export function resolveSafePath(workspaceRoot: string, requestedPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, requestedPath);
  const relative = path.relative(root, resolved);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }

  throw new PathSandboxViolationError(root, requestedPath);
}
