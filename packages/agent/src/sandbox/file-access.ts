/*
 * Classifies workspace paths and applies authorized, canonical file operations.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolExecutionFileAccess } from './sandbox-scope';
import type { ToolEffectPath, ToolExecutionErrorCode, ToolExecutionContext, BuiltInToolContext } from '../tools/tool-contracts';
import { ToolExecutionFailure } from '../tools/tool-result';

/* Defines the canonical, bounded file operations exposed by one Sandbox scope. */

export interface SandboxFileEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
  readonly path: string;
}

export interface SandboxWalkWarning { readonly path: string; readonly code: string; readonly message: string }
export interface SandboxWalkResult {
  readonly files: readonly string[];
  readonly scannedFileCount: number;
  readonly skippedCount: number;
  readonly limitReached: boolean;
  readonly warnings: readonly SandboxWalkWarning[];
}

export interface SandboxTextEdit {
  readonly oldText: string;
  readonly newText: string;
}

export interface SandboxFileAccess {
  readBinaryFile(request: { readonly path: string; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly bytes: Uint8Array; readonly sizeBytes: number; readonly fingerprint: string;
  }>;
  readFile(request: { readonly path: string; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly content: string; readonly sizeBytes: number; readonly fingerprint: string;
  }>;
  listDirectory(request: { readonly path: string; readonly maxDepth: number; readonly includeHidden: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly entries: readonly SandboxFileEntry[];
  }>;
  walkFiles(request: { readonly path: string; readonly includeHidden?: boolean; readonly maxFiles?: number; readonly maxDepth?: number; readonly signal?: AbortSignal }): Promise<SandboxWalkResult>;
  editFile(request: { readonly path: string; readonly edits: readonly SandboxTextEdit[]; readonly expectedFingerprint?: string; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly replacements: number; readonly changed: boolean; readonly previousFingerprint: string; readonly fingerprint: string;
  }>;
  replaceText(request: { readonly path: string; readonly oldText: string; readonly newText: string; readonly replaceAll: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly replacements: number; readonly changed: boolean;
  }>;
  writeFile(request: { readonly path: string; readonly content: string; readonly overwrite: boolean; readonly expectedFingerprint?: string; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly bytesWritten: number; readonly created: boolean; readonly overwritten: boolean; readonly fingerprint: string;
  }>;
  createDirectory(request: { readonly path: string; readonly recursive: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly created: boolean;
  }>;
  copyPath(request: { readonly source: string; readonly destination: string; readonly overwrite: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly source: string; readonly destination: string; readonly pathType: 'file' | 'directory';
  }>;
  movePath(request: { readonly source: string; readonly destination: string; readonly overwrite: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly source: string; readonly destination: string; readonly pathType: 'file' | 'directory';
  }>;
  deletePath(request: { readonly path: string; readonly recursive: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly pathType: 'file' | 'directory'; readonly recoverable: true; readonly recoveryPath: string;
  }>;
  resolveCommandCwd(request: { readonly path: string; readonly signal?: AbortSignal }): Promise<string>;
}

/*
 * Owns lexical and canonical Workspace path classification without deciding permissions.
 */

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
  classifyCanonicalPath(request: ResolveCanonicalWorkspacePathRequest): Promise<WorkspacePathClassification>;
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
    classifyCanonicalPath,
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
  return DEFAULT_PROTECTED_WORKSPACE_PATHS.directories.some(directory => directory === firstSegment)
    || DEFAULT_PROTECTED_WORKSPACE_PATHS.files.some(file => file === normalized)
    || protectedPathHints.some((hint) => matchesProtectedPathHint(normalized, hint));
}

export function isSensitiveWorkspacePath(workspacePath: string): boolean {
  const normalized = normalizeWorkspaceSlash(workspacePath);
  return DEFAULT_SENSITIVE_WORKSPACE_PATHS.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function normalizeWorkspaceSlash(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

async function classifyCanonicalPath(
  request: ResolveCanonicalWorkspacePathRequest,
): Promise<WorkspacePathClassification> {
  const platform = request.platform ?? process.platform;
  const pathApi = pathApiFor(platform);
  const canonicalRoot = pathApi.resolve(await request.file_system.realpath(pathApi.resolve(request.workspace_root)));
  const lexical = classifyWorkspacePath(request);
  const canonicalTarget = await canonicalizePotentialPath(
    lexical.absolute_path,
    pathApi,
    request.file_system,
  );
  return classifyWorkspacePath({
    ...request,
    workspace_root: canonicalRoot,
    target_path: canonicalTarget,
    platform,
  });
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

/* Implements canonical Workspace file actions with conflict-safe Node filesystem operations. */

const MAX_EDIT_COUNT = 100;
const MAX_EDIT_BYTES = 1_000_000;
const DEFAULT_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const MAX_TRAVERSAL_FILES = 10_000;
const MAX_TRAVERSAL_DEPTH = 32;
const MAX_TRAVERSAL_WARNINGS = 100;

export class SandboxFileError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SandboxFileError';
  }
}

export function createNodeSandboxFileAccess(input: {
  readonly workspaceRoot: string;
  readonly access?: ToolExecutionFileAccess;
}): SandboxFileAccess {
  const pathPolicy = createWorkspacePathPolicy();
  const fileAccess = input.access ?? { mode: 'workspace' as const };
  const canonicalRootPromise = fs.realpath(path.resolve(input.workspaceRoot));
  const canonicalize = async (candidate: string) => {
    const canonicalRoot = await canonicalRootPromise;
    const absolutePath = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(canonicalRoot, candidate);
    return canonicalizeFileTarget(absolutePath);
  };
  const grantsPromise = fileAccess.mode === 'workspace_and_paths'
    ? Promise.all([
        Promise.all(fileAccess.readablePaths.map(canonicalize)),
        Promise.all(fileAccess.writablePaths.map(canonicalize)),
      ]).then(([readable, writable]) => ({ readable, writable }))
    : Promise.resolve({ readable: [] as string[], writable: [] as string[] });

  const resolve = async (candidate: string, requiredAccess: 'read' | 'write' = 'read') => {
    const canonicalRoot = await canonicalRootPromise;
    const absolutePath = await canonicalize(candidate);
    const insideWorkspace = sameOrDescendant(canonicalRoot, absolutePath);
    if (!insideWorkspace && fileAccess.mode !== 'unrestricted') {
      const grants = await grantsPromise;
      const allowedPaths = requiredAccess === 'read' ? grants.readable : grants.writable;
      if (!allowedPaths.some((allowedPath) => sameOrDescendant(allowedPath, absolutePath))) {
        throw new SandboxFileError('path_outside_workspace', 'Path is outside the permitted file scope.');
      }
    }
    const classification = pathPolicy.classifyPath({
      workspace_root: canonicalRoot,
      target_path: absolutePath,
    });
    return {
      absolutePath,
      workspacePath: insideWorkspace
        ? normalizeSlash(path.relative(canonicalRoot, absolutePath))
        : absolutePath,
      insideWorkspace,
      protected: insideWorkspace && classification.protected,
      sensitive: insideWorkspace && classification.sensitive,
    };
  };

  const ensureSignal = (signal?: AbortSignal) => signal?.throwIfAborted();

  const readBytes = async (
    candidate: string,
    signal?: AbortSignal,
    requiredAccess: 'read' | 'write' = 'read',
  ) => {
    ensureSignal(signal);
    const resolved = await resolve(candidate, requiredAccess);
    const value = await fs.readFile(resolved.absolutePath, { signal });
    return { ...resolved, value, fingerprint: fingerprint(value) };
  };

  const atomicReplace = async (absolutePath: string, content: string, expectedFingerprint: string, signal?: AbortSignal) => {
    ensureSignal(signal);
    const temporaryPath = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.${randomUUID()}.megumi-tmp`);
    try {
      await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', signal });
      ensureSignal(signal);
      const current = await readOptional(absolutePath);
      if (!current || fingerprint(current) !== expectedFingerprint) {
        throw new SandboxFileError('content_conflict', 'The file changed before the replacement was committed.');
      }
      await fs.rename(temporaryPath, absolutePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  };

  const applyEdits = (content: string, edits: readonly SandboxTextEdit[]) => {
    if (edits.length === 0 || edits.length > MAX_EDIT_COUNT) {
      throw new SandboxFileError('invalid_tool_input', `edit_file requires between 1 and ${MAX_EDIT_COUNT} edits.`);
    }
    const totalBytes = edits.reduce((total, edit) => total + Buffer.byteLength(edit.oldText) + Buffer.byteLength(edit.newText), 0);
    if (totalBytes > MAX_EDIT_BYTES) throw new SandboxFileError('output_limit', 'Edit content exceeds the configured limit.');
    const located = edits.map((edit) => {
      if (edit.oldText.length === 0) throw new SandboxFileError('invalid_tool_input', 'oldText cannot be empty.');
      const first = content.indexOf(edit.oldText);
      if (first < 0) throw new SandboxFileError('content_conflict', 'An edit target was not found.');
      if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0) {
        throw new SandboxFileError('content_conflict', 'An edit target is not unique.');
      }
      return { ...edit, start: first, end: first + edit.oldText.length };
    }).sort((left, right) => left.start - right.start);
    for (let index = 1; index < located.length; index += 1) {
      if (located[index].start < located[index - 1].end) throw new SandboxFileError('content_conflict', 'Edits overlap.');
    }
    let output = '';
    let cursor = 0;
    for (const edit of located) {
      output += content.slice(cursor, edit.start) + edit.newText;
      cursor = edit.end;
    }
    return output + content.slice(cursor);
  };

  const copy = async (source: string, destination: string, overwrite: boolean, signal?: AbortSignal) => {
    ensureSignal(signal);
    const from = await resolve(source, 'read');
    const to = await resolve(destination, 'write');
    if (from.absolutePath === to.absolutePath) throw new SandboxFileError('path_conflict', 'Source and destination are the same path.');
    const sourceStat = await fs.stat(from.absolutePath);
    if (!sourceStat.isFile() && !sourceStat.isDirectory()) throw new SandboxFileError('path_type_mismatch', 'Only files and directories can be copied.');
    if (sourceStat.isDirectory() && sameOrDescendant(from.absolutePath, to.absolutePath)) throw new SandboxFileError('path_conflict', 'A directory cannot be copied into itself.');
    const destinationExists = await exists(to.absolutePath);
    if (destinationExists && !overwrite) throw new SandboxFileError('path_conflict', 'Destination already exists.');
    await fs.mkdir(path.dirname(to.absolutePath), { recursive: true });
    const staged = path.join(path.dirname(to.absolutePath), `.${path.basename(to.absolutePath)}.${randomUUID()}.megumi-copy`);
    const backup = destinationExists
      ? path.join(path.dirname(to.absolutePath), `.${path.basename(to.absolutePath)}.${randomUUID()}.megumi-backup`)
      : undefined;
    try {
      if (sourceStat.isDirectory()) await fs.cp(from.absolutePath, staged, { recursive: true, force: false, errorOnExist: true });
      else await fs.copyFile(from.absolutePath, staged, fsConstantsCopyExcl());
      ensureSignal(signal);
      if (backup) await fs.rename(to.absolutePath, backup);
      try { await fs.rename(staged, to.absolutePath); }
      catch (error) {
        if (backup) await fs.rename(backup, to.absolutePath).catch(() => undefined);
        throw error;
      }
      if (backup) await fs.rm(backup, { recursive: true, force: true });
    } finally {
      await fs.rm(staged, { recursive: true, force: true }).catch(() => undefined);
    }
    return { source: from.workspacePath, destination: to.workspacePath, pathType: sourceStat.isDirectory() ? 'directory' as const : 'file' as const };
  };

  return {
    async readBinaryFile(request) {
      const result = await readBytes(request.path, request.signal);
      return { path: result.workspacePath, bytes: new Uint8Array(result.value), sizeBytes: result.value.byteLength, fingerprint: result.fingerprint };
    },
    async readFile(request) {
      const result = await readBytes(request.path, request.signal);
      return { path: result.workspacePath, content: result.value.toString('utf8'), sizeBytes: result.value.byteLength, fingerprint: result.fingerprint };
    },
    async listDirectory(request) {
      const root = await resolve(request.path);
      const entries: Array<{ name: string; kind: 'file' | 'directory'; path: string }> = [];
      const collect = async (absoluteDirectory: string, relativeDirectory: string, depth: number) => {
        ensureSignal(request.signal);
        for (const entry of await fs.readdir(absoluteDirectory, { withFileTypes: true })) {
          ensureSignal(request.signal);
          if ((!entry.isFile() && !entry.isDirectory()) || shouldIgnore(entry.name, request.includeHidden)) continue;
          const relative = normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
          entries.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file', path: relative });
          if (entry.isDirectory() && depth < request.maxDepth) await collect(path.join(absoluteDirectory, entry.name), relative, depth + 1);
        }
      };
      await collect(root.absolutePath, root.workspacePath === '.' ? '' : root.workspacePath, 1);
      return { path: root.workspacePath, entries: entries.sort((a, b) => a.path.localeCompare(b.path)) };
    },
    async walkFiles(request) {
      const root = await resolve(request.path);
      const stat = await fs.stat(root.absolutePath);
      if (stat.isFile()) {
        const skipped = root.protected || root.sensitive;
        return { files: skipped ? [] : [root.workspacePath], scannedFileCount: 1, skippedCount: skipped ? 1 : 0, limitReached: false, warnings: skipped ? [{ path: root.workspacePath, code: 'sensitive_or_protected', message: 'The file was skipped by Workspace policy.' }] : [] };
      }
      if (!stat.isDirectory()) throw new SandboxFileError('path_type_mismatch', 'The requested path is not a directory.');
      const maxFiles = Math.min(request.maxFiles ?? MAX_TRAVERSAL_FILES, MAX_TRAVERSAL_FILES);
      const maxDepth = Math.min(request.maxDepth ?? MAX_TRAVERSAL_DEPTH, MAX_TRAVERSAL_DEPTH);
      const files: string[] = [];
      const warnings: Array<{ path: string; code: string; message: string }> = [];
      let scannedFileCount = 0;
      let skippedCount = 0;
      let limitReached = false;
      const warn = (pathValue: string, code: string, message: string) => {
        skippedCount += 1;
        if (warnings.length < MAX_TRAVERSAL_WARNINGS) warnings.push({ path: pathValue, code, message });
      };
      const walk = async (absoluteDirectory: string, relativeDirectory: string, depth: number) => {
        ensureSignal(request.signal);
        if (depth > maxDepth || limitReached) { limitReached = true; return; }
        let entries;
        try { entries = await fs.readdir(absoluteDirectory, { withFileTypes: true }); }
        catch { warn(relativeDirectory || '.', 'directory_unreadable', 'The directory could not be read.'); return; }
        for (const entry of entries) {
          ensureSignal(request.signal);
          if (limitReached) return;
          if (shouldIgnore(entry.name, request.includeHidden ?? false)) { warn(normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name), 'ignored', 'The path was skipped by traversal policy.'); continue; }
          const relative = normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
          if (entry.isDirectory()) { await walk(path.join(absoluteDirectory, entry.name), relative, depth + 1); continue; }
          if (!entry.isFile()) { warn(relative, 'unsupported_path_type', 'Only regular files are scanned.'); continue; }
          scannedFileCount += 1;
          if (scannedFileCount > maxFiles) { limitReached = true; return; }
          try {
            const resolved = await resolve(relative);
            if (resolved.protected || resolved.sensitive) { warn(relative, 'sensitive_or_protected', 'The file was skipped by Workspace policy.'); continue; }
            files.push(relative);
          } catch { warn(relative, 'path_unavailable', 'The file could not be resolved safely.'); }
        }
      };
      await walk(root.absolutePath, root.workspacePath === '.' ? '' : root.workspacePath, 1);
      return { files: files.sort(), scannedFileCount, skippedCount, limitReached, warnings };
    },    async editFile(request) {
      const before = await readBytes(request.path, request.signal, 'write');
      if (request.expectedFingerprint && request.expectedFingerprint !== before.fingerprint) throw new SandboxFileError('content_conflict', 'The file changed after it was read.');
      const content = before.value.toString('utf8');
      const updated = applyEdits(content, request.edits);
      if (updated === content) return { path: before.workspacePath, replacements: request.edits.length, changed: false, previousFingerprint: before.fingerprint, fingerprint: before.fingerprint };
      const current = await readBytes(request.path, request.signal, 'write');
      if (current.fingerprint !== before.fingerprint) throw new SandboxFileError('content_conflict', 'The file changed before the edit was committed.');
      await atomicReplace(before.absolutePath, updated, before.fingerprint, request.signal);
      return { path: before.workspacePath, replacements: request.edits.length, changed: true, previousFingerprint: before.fingerprint, fingerprint: fingerprint(Buffer.from(updated)) };
    },
    async replaceText(request) {
      const before = await readBytes(request.path, request.signal, 'write');
      const content = before.value.toString('utf8');
      const occurrences = content.split(request.oldText).length - 1;
      if (occurrences === 0) throw new SandboxFileError('content_conflict', 'Text was not found in the file.');
      if (!request.replaceAll && occurrences > 1) throw new SandboxFileError('content_conflict', 'Text occurs more than once in the file.');
      const edits = request.replaceAll
        ? Array.from({ length: occurrences }, () => ({ oldText: request.oldText, newText: request.newText }))
        : [{ oldText: request.oldText, newText: request.newText }];
      const updated = request.replaceAll ? content.split(request.oldText).join(request.newText) : content.replace(request.oldText, request.newText);
      if (updated !== content) {
        const current = await readBytes(request.path, request.signal, 'write');
        if (current.fingerprint !== before.fingerprint) throw new SandboxFileError('content_conflict', 'The file changed before the edit was committed.');
        await atomicReplace(before.absolutePath, updated, before.fingerprint, request.signal);
      }
      return { path: before.workspacePath, replacements: edits.length, changed: updated !== content };
    },
    async writeFile(request) {
      ensureSignal(request.signal);
      const target = await resolve(request.path, 'write');
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      const existing = await readOptional(target.absolutePath);
      if (existing && !request.overwrite) throw new SandboxFileError('path_conflict', 'Destination already exists.');
      if (request.expectedFingerprint && (!existing || fingerprint(existing) !== request.expectedFingerprint)) throw new SandboxFileError('content_conflict', 'The file changed after it was read.');
      if (existing) await atomicReplace(target.absolutePath, request.content, fingerprint(existing), request.signal);
      else await fs.writeFile(target.absolutePath, request.content, { encoding: 'utf8', flag: 'wx', signal: request.signal });
      return { path: target.workspacePath, bytesWritten: Buffer.byteLength(request.content), created: !existing, overwritten: Boolean(existing), fingerprint: fingerprint(Buffer.from(request.content)) };
    },
    async createDirectory(request) {
      ensureSignal(request.signal);
      const target = await resolve(request.path, 'write');
      const existed = await exists(target.absolutePath);
      await fs.mkdir(target.absolutePath, { recursive: request.recursive });
      return { path: target.workspacePath, created: !existed };
    },
    copyPath: (request) => copy(request.source, request.destination, request.overwrite, request.signal),
    async movePath(request) {
      ensureSignal(request.signal);
      const source = await resolve(request.source, 'write');
      const destination = await resolve(request.destination, 'write');
      if (source.absolutePath === destination.absolutePath) throw new SandboxFileError('path_conflict', 'Source and destination are the same path.');
      const sourceStat = await fs.stat(source.absolutePath);
      if (!sourceStat.isFile() && !sourceStat.isDirectory()) throw new SandboxFileError('path_type_mismatch', 'Only files and directories can be moved.');
      if (sourceStat.isDirectory() && sameOrDescendant(source.absolutePath, destination.absolutePath)) throw new SandboxFileError('path_conflict', 'A directory cannot be moved into itself.');
      const destinationExists = await exists(destination.absolutePath);
      if (destinationExists && !request.overwrite) throw new SandboxFileError('path_conflict', 'Destination already exists.');
      await fs.mkdir(path.dirname(destination.absolutePath), { recursive: true });
      const backup = destinationExists
        ? path.join(path.dirname(destination.absolutePath), `.${path.basename(destination.absolutePath)}.${randomUUID()}.megumi-backup`)
        : undefined;
      if (backup) await fs.rename(destination.absolutePath, backup);
      try { await fs.rename(source.absolutePath, destination.absolutePath); }
      catch (error) {
        if (backup) await fs.rename(backup, destination.absolutePath).catch(() => undefined);
        throw error;
      }
      if (backup) await fs.rm(backup, { recursive: true, force: true });
      return { source: source.workspacePath, destination: destination.workspacePath, pathType: sourceStat.isDirectory() ? 'directory' as const : 'file' as const };
    },
    async deletePath(request) {
      ensureSignal(request.signal);
      const target = await resolve(request.path, 'write');
      if (target.insideWorkspace && target.workspacePath === '.') throw new SandboxFileError('sandbox_denied', 'The Workspace root cannot be deleted.');
      const stat = await fs.stat(target.absolutePath);
      if (stat.isDirectory() && !request.recursive && (await fs.readdir(target.absolutePath)).length > 0) throw new SandboxFileError('sandbox_denied', 'Deleting a non-empty directory requires recursive=true.');
      const canonicalRoot = await canonicalRootPromise;
      const recoveryDirectory = path.join(
        target.insideWorkspace ? canonicalRoot : path.dirname(target.absolutePath),
        '.megumi-trash',
        randomUUID(),
      );
      const recoveryTarget = path.join(recoveryDirectory, path.basename(target.absolutePath));
      await fs.mkdir(recoveryDirectory, { recursive: true });
      await fs.rename(target.absolutePath, recoveryTarget);
      return {
        path: target.workspacePath,
        pathType: stat.isDirectory() ? 'directory' : 'file',
        recoverable: true,
        recoveryPath: target.insideWorkspace
          ? normalizeSlash(path.relative(canonicalRoot, recoveryTarget))
          : recoveryTarget,
      };
    },
    async resolveCommandCwd(request) {
      ensureSignal(request.signal);
      const target = await resolve(request.path);
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isDirectory()) throw new SandboxFileError('path_type_mismatch', 'Command cwd must be a directory.');
      return target.absolutePath;
    },
  };
}

async function canonicalizeFileTarget(absolutePath: string): Promise<string> {
  let existingCandidate = absolutePath;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const canonicalExisting = await fs.realpath(existingCandidate);
      return path.resolve(canonicalExisting, ...missingSegments);
    } catch {
      const parent = path.dirname(existingCandidate);
      if (parent === existingCandidate) throw new SandboxFileError('path_unavailable', 'Path has no resolvable ancestor.');
      missingSegments.unshift(path.basename(existingCandidate));
      existingCandidate = parent;
    }
  }
}
function sameOrDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function fingerprint(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function exists(target: string): Promise<boolean> {
  try { await fs.lstat(target); return true; } catch (error) { if (nodeCode(error) === 'ENOENT') return false; throw error; }
}

async function readOptional(target: string): Promise<Buffer | undefined> {
  try { return await fs.readFile(target); } catch (error) { if (nodeCode(error) === 'ENOENT') return undefined; throw error; }
}

function nodeCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

function normalizeSlash(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '') || '.';
}

function shouldIgnore(name: string, includeHidden: boolean): boolean {
  if (DEFAULT_IGNORED_DIRECTORIES.has(name)) return true;
  return !includeHidden && name.startsWith('.');
}

function fsConstantsCopyExcl(): number {
  return 1;
}

export function toolEffectPath(value: string): ToolEffectPath {
  return { location: path.isAbsolute(value) ? 'external' : 'workspace', path: value };
}
export async function withFileFailure<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ToolExecutionFailure) throw error;
    const reason = fileFailureReason(error);
    if (!reason) throw error;
    throw new ToolExecutionFailure(fileFailureMessage(reason), fileErrorCode(reason), { reason, operation });
  }
}

export function assertTextMutationTarget(targetPath: string): void {
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === '.docx' || extension === '.pdf') {
    throw new ToolExecutionFailure(
      `${extension.slice(1).toUpperCase()} structured editing is not supported by text file tools.`,
      'path_type_mismatch',
      { reason: 'unsupported_structured_document', extension },
    );
  }
}

function fileFailureReason(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  if (code === 'ENOENT') return 'not_found';
  if (code === 'EACCES' || code === 'EPERM') return 'access_denied';
  if (code === 'EISDIR') return 'expected_file';
  if (code === 'ENOTDIR') return 'expected_directory';
  return code;
}

function fileErrorCode(reason: string): ToolExecutionErrorCode {
  if (reason === 'not_found') return 'path_not_found';
  if (reason === 'expected_file' || reason === 'expected_directory') return 'path_type_mismatch';
  if (reason === 'path_outside_workspace' || reason === 'symlink_escape') return 'path_outside_workspace';
  if (reason === 'path_conflict' || reason === 'content_conflict' || reason === 'sandbox_denied' || reason === 'output_limit' || reason === 'invalid_tool_input') return reason;
  return 'tool_execution_failed';
}

function fileFailureMessage(reason: string): string {
  if (reason === 'not_found') return 'The requested file or directory was not found.';
  if (reason === 'access_denied') return 'Access to the requested file or directory was denied.';
  if (reason === 'expected_file') return 'The requested path is not a readable file.';
  if (reason === 'expected_directory') return 'The requested path is not a readable directory.';
  if (reason === 'path_outside_workspace' || reason === 'symlink_escape') return 'Path is outside the active Workspace.';
  if (reason === 'path_conflict') return 'The destination conflicts with an existing path.';
  if (reason === 'content_conflict') return 'The file content changed or the requested edit no longer matches.';
  if (reason === 'sandbox_denied') return 'The Sandbox denied this file operation.';
  if (reason === 'output_limit') return 'The file operation exceeded its configured limit.';
  return 'The file operation failed.';
}

/** Requires the controlled file capability supplied after authorization. */
export function fileContext(execution: ToolExecutionContext): BuiltInToolContext {
  if (!execution.files) throw new ToolExecutionFailure('This tool requires a workspace.', 'sandbox_unavailable');
  return { workspaceFileAccess: execution.files, process: execution.process };
}
