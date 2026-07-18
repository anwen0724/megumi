/*
 * Pure Workspace path policy helpers. Public services translate these facts
 * into structured service results without throwing for validation failures.
 */
import path from 'node:path';

export const DEFAULT_PROTECTED_WORKSPACE_PATHS = {
  directories: ['.git', '.vscode', '.idea', '.husky', '.megumi'],
  files: ['.gitconfig', '.gitmodules', '.ripgreprc', '.mcp.json', '.megumi.json'],
} as const;

export const DEFAULT_SENSITIVE_WORKSPACE_PATHS = [
  '.env',
  '.env.*',
  'secrets/**',
  '*.pem',
  '*.key',
  'id_rsa',
  'id_ed25519',
] as const;

export interface WorkspacePathPolicyInput {
  workspace_root: string;
  target_path: string;
  platform?: NodeJS.Platform;
  protected_path_hints?: readonly string[];
}

export interface WorkspacePathPolicyClassification {
  absolute_path: string;
  workspace_path: string;
  inside_workspace: boolean;
  protected: boolean;
  sensitive: boolean;
}

export function classifyWorkspacePath(input: WorkspacePathPolicyInput): WorkspacePathPolicyClassification {
  const pathApi = pathApiForPlatform(input.platform ?? process.platform);
  const workspaceRoot = pathApi.resolve(input.workspace_root);
  const absolutePath = pathApi.resolve(workspaceRoot, input.target_path);
  const workspacePath = normalizeWorkspaceSlash(pathApi.relative(workspaceRoot, absolutePath));
  const insideWorkspace = isInsideWorkspace(workspacePath, pathApi);

  return {
    absolute_path: absolutePath,
    workspace_path: workspacePath || '.',
    inside_workspace: insideWorkspace,
    protected: insideWorkspace && isProtectedWorkspacePath(workspacePath, input.protected_path_hints),
    sensitive: insideWorkspace && isSensitiveWorkspacePath(workspacePath),
  };
}

export function isProtectedWorkspacePath(
  workspace_path: string,
  protected_path_hints: readonly string[] = [],
): boolean {
  const normalized = normalizeWorkspaceSlash(workspace_path);
  const firstSegment = normalized.split('/')[0];

  return DEFAULT_PROTECTED_WORKSPACE_PATHS.directories.includes(firstSegment as never)
    || DEFAULT_PROTECTED_WORKSPACE_PATHS.files.includes(normalized as never)
    || protected_path_hints.some((hint) => matchesProtectedPathHint(normalized, hint));
}

export function isSensitiveWorkspacePath(workspace_path: string): boolean {
  const normalized = normalizeWorkspaceSlash(workspace_path);
  return DEFAULT_SENSITIVE_WORKSPACE_PATHS.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function normalizeWorkspaceSlash(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function pathApiForPlatform(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function isInsideWorkspace(workspace_path: string, pathApi: typeof path.win32 | typeof path.posix): boolean {
  return workspace_path === ''
    || (workspace_path !== '..' && !workspace_path.startsWith('../') && !pathApi.isAbsolute(workspace_path));
}

function matchesProtectedPathHint(workspace_path: string, hint: string): boolean {
  const normalizedHint = normalizeWorkspaceSlash(hint).replace(/^\/+|\/+$/g, '');
  return normalizedHint.length > 0
    && (workspace_path === normalizedHint || workspace_path.startsWith(`${normalizedHint}/`));
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }

    if (char === '*') {
      source += '[^/]*';
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}
