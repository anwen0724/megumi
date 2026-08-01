/*
 * Owns lexical and canonical Workspace path classification without deciding permissions.
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

export interface ClassifyWorkspacePathRequest {
  workspace_root: string;
  target_path: string;
  platform?: NodeJS.Platform;
  protected_path_hints?: readonly string[];
}
export interface WorkspacePathClassification {
  absolute_path: string;
  workspace_path: string;
  inside_workspace: boolean;
  protected: boolean;
  sensitive: boolean;
}
export type ResolveWorkspacePathRequest = ClassifyWorkspacePathRequest;
export type ResolveWorkspacePathResult =
  | {
      status: 'resolved';
      absolute_path: string;
      workspace_path: string;
      protected: boolean;
      sensitive: boolean;
    }
  | { status: 'outside_workspace'; target_path: string };
export type AssertOrdinaryWorkspacePathRequest = ClassifyWorkspacePathRequest;
export type AssertOrdinaryWorkspacePathResult =
  | { status: 'ok'; absolute_path: string; workspace_path: string }
  | { status: 'rejected'; reason: 'outside_workspace' | 'protected_path' | 'sensitive_path' };

export interface WorkspaceCanonicalPathFileSystem {
  realpath(path: string): Promise<string>;
}
export interface ResolveCanonicalWorkspacePathRequest extends ClassifyWorkspacePathRequest {
  file_system: WorkspaceCanonicalPathFileSystem;
}

export interface WorkspacePathPolicy {
  classifyPath(request: ClassifyWorkspacePathRequest): WorkspacePathClassification;
  resolvePath(request: ResolveWorkspacePathRequest): ResolveWorkspacePathResult;
  assertOrdinaryPath(request: AssertOrdinaryWorkspacePathRequest): AssertOrdinaryWorkspacePathResult;
  resolveCanonicalPath(request: ResolveCanonicalWorkspacePathRequest): Promise<ResolveWorkspacePathResult>;
}

export function createWorkspacePathPolicy(): WorkspacePathPolicy {
  return {
    classifyPath: classifyWorkspacePath,
    resolvePath: resolveWorkspacePath,
    assertOrdinaryPath(request) {
      const classification = classifyWorkspacePath(request);
      if (!classification.inside_workspace) return { status: 'rejected', reason: 'outside_workspace' };
      if (classification.protected) return { status: 'rejected', reason: 'protected_path' };
      if (classification.sensitive) return { status: 'rejected', reason: 'sensitive_path' };
      return {
        status: 'ok',
        absolute_path: classification.absolute_path,
        workspace_path: classification.workspace_path,
      };
    },
    resolveCanonicalPath,
  };
}

export function classifyWorkspacePath(request: ClassifyWorkspacePathRequest): WorkspacePathClassification {
  const pathApi = pathApiFor(request.platform ?? process.platform);
  const workspaceRoot = pathApi.resolve(request.workspace_root);
  const absolutePath = pathApi.resolve(workspaceRoot, request.target_path);
  const workspacePath = normalizeWorkspaceSlash(pathApi.relative(workspaceRoot, absolutePath));
  const insideWorkspace = isInsideWorkspace(workspacePath, pathApi);
  return {
    absolute_path: absolutePath,
    workspace_path: workspacePath || '.',
    inside_workspace: insideWorkspace,
    protected: insideWorkspace && isProtectedWorkspacePath(workspacePath, request.protected_path_hints),
    sensitive: insideWorkspace && isSensitiveWorkspacePath(workspacePath),
  };
}

export function isProtectedWorkspacePath(
  workspacePath: string,
  protectedPathHints: readonly string[] = [],
): boolean {
  const normalized = normalizeWorkspaceSlash(workspacePath);
  const firstSegment = normalized.split('/')[0];
  return DEFAULT_PROTECTED_WORKSPACE_PATHS.directories.includes(firstSegment as never)
    || DEFAULT_PROTECTED_WORKSPACE_PATHS.files.includes(normalized as never)
    || protectedPathHints.some((hint) => matchesProtectedPathHint(normalized, hint));
}

export function isSensitiveWorkspacePath(workspacePath: string): boolean {
  const normalized = normalizeWorkspaceSlash(workspacePath);
  return DEFAULT_SENSITIVE_WORKSPACE_PATHS.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function normalizeWorkspaceSlash(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

async function resolveCanonicalPath(
  request: ResolveCanonicalWorkspacePathRequest,
): Promise<ResolveWorkspacePathResult> {
  const platform = request.platform ?? process.platform;
  const pathApi = pathApiFor(platform);
  const lexical = classifyWorkspacePath(request);
  if (!lexical.inside_workspace) {
    return { status: 'outside_workspace', target_path: request.target_path };
  }

  const canonicalRoot = pathApi.resolve(await request.file_system.realpath(pathApi.resolve(request.workspace_root)));
  const canonicalTarget = await canonicalizePotentialPath(
    lexical.absolute_path,
    pathApi,
    request.file_system,
  );
  const canonical = classifyWorkspacePath({
    ...request,
    workspace_root: canonicalRoot,
    target_path: canonicalTarget,
    platform,
  });
  return canonical.inside_workspace
    ? {
        status: 'resolved',
        absolute_path: canonical.absolute_path,
        workspace_path: canonical.workspace_path,
        protected: canonical.protected,
        sensitive: canonical.sensitive,
      }
    : { status: 'outside_workspace', target_path: request.target_path };
}

async function canonicalizePotentialPath(
  absolutePath: string,
  pathApi: typeof path.win32 | typeof path.posix,
  fileSystem: WorkspaceCanonicalPathFileSystem,
): Promise<string> {
  let existingCandidate = absolutePath;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const canonicalExisting = await fileSystem.realpath(existingCandidate);
      return pathApi.resolve(canonicalExisting, ...missingSegments);
    } catch {
      const parent = pathApi.dirname(existingCandidate);
      if (parent === existingCandidate) throw new Error('Workspace path has no resolvable ancestor.');
      missingSegments.unshift(pathApi.basename(existingCandidate));
      existingCandidate = parent;
    }
  }
}

function resolveWorkspacePath(request: ResolveWorkspacePathRequest): ResolveWorkspacePathResult {
  const classification = classifyWorkspacePath(request);
  return classification.inside_workspace
    ? {
        status: 'resolved',
        absolute_path: classification.absolute_path,
        workspace_path: classification.workspace_path,
        protected: classification.protected,
        sensitive: classification.sensitive,
      }
    : { status: 'outside_workspace', target_path: request.target_path };
}

function pathApiFor(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}
function isInsideWorkspace(workspacePath: string, pathApi: typeof path.win32 | typeof path.posix): boolean {
  return workspacePath === ''
    || (workspacePath !== '..' && !workspacePath.startsWith('../') && !pathApi.isAbsolute(workspacePath));
}
function matchesProtectedPathHint(workspacePath: string, hint: string): boolean {
  const normalizedHint = normalizeWorkspaceSlash(hint).replace(/^\/+|\/+$/g, '');
  return normalizedHint.length > 0
    && (workspacePath === normalizedHint || workspacePath.startsWith(`${normalizedHint}/`));
}
function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') source += '[^/]*';
    else source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`);
}
function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}
