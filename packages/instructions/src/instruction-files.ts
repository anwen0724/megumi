/* Defines instruction-file I/O contracts and the exact AGENTS.md discovery policy. */
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentInstructionSource,
  EffectiveInstructionFailure,
  InstructionOperationOptions,
} from './instructions';

const INSTRUCTION_FILE_NAME = 'AGENTS.md';

export interface InstructionSourceOperationOptions {
  readonly signal?: AbortSignal;
}

export interface ResolveInstructionPathRequest {
  readonly path: string;
}

export type ResolveInstructionPathResult =
  | { readonly status: 'resolved'; readonly path: string }
  | { readonly status: 'missing' }
  | { readonly status: 'failed' }
  | { readonly status: 'cancelled' };

export interface ReadInstructionDirectoryRequest {
  readonly directoryPath: string;
}

export type ReadInstructionDirectoryResult =
  | { readonly status: 'read'; readonly entries: readonly string[] }
  | { readonly status: 'missing' }
  | { readonly status: 'failed' }
  | { readonly status: 'cancelled' };

export interface ReadInstructionFileRequest {
  readonly filePath: string;
}

export type ReadInstructionFileResult =
  | { readonly status: 'read'; readonly content: string }
  | { readonly status: 'missing' }
  | { readonly status: 'failed' }
  | { readonly status: 'cancelled' };

export interface InstructionSource {
  realPath(
    request: ResolveInstructionPathRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ResolveInstructionPathResult>;
  readDirectory(
    request: ReadInstructionDirectoryRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ReadInstructionDirectoryResult>;
  readFile(
    request: ReadInstructionFileRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ReadInstructionFileResult>;
}

export function createNodeInstructionSource(): InstructionSource {
  return new NodeInstructionSource();
}

interface LoadInstructionFilesRequest {
  readonly megumiHomePath: string;
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly source: InstructionSource;
}

type LoadInstructionFilesResult =
  | { readonly status: 'ok'; readonly sources: AgentInstructionSource[] }
  | { readonly status: 'failed'; readonly failure: EffectiveInstructionFailure }
  | { readonly status: 'cancelled' };

interface InstructionScope {
  readonly directoryPath: string;
  readonly allowedRootPath: string;
  readonly missingIsAllowed: boolean;
}

export async function loadInstructionFiles(
  request: LoadInstructionFilesRequest,
  options?: InstructionOperationOptions,
): Promise<LoadInstructionFilesResult> {
  if (options?.signal?.aborted) return { status: 'cancelled' };

  const workspaceRoot = path.resolve(request.workspaceRoot);
  const workingDirectory = path.resolve(request.workingDirectory);
  if (!isWithin(workspaceRoot, workingDirectory)) {
    return workingDirectoryOutsideWorkspace();
  }

  const realWorkspaceResult = await request.source.realPath(
    { path: workspaceRoot },
    options,
  );
  if (realWorkspaceResult.status === 'cancelled') return { status: 'cancelled' };
  if (realWorkspaceResult.status !== 'resolved') {
    return scopeUnavailable(workspaceRoot);
  }

  const realWorkingDirectoryResult = await request.source.realPath(
    { path: workingDirectory },
    options,
  );
  if (realWorkingDirectoryResult.status === 'cancelled') return { status: 'cancelled' };
  if (realWorkingDirectoryResult.status !== 'resolved') {
    return scopeUnavailable(workingDirectory);
  }

  const realWorkspaceRoot = path.resolve(realWorkspaceResult.path);
  const realWorkingDirectory = path.resolve(realWorkingDirectoryResult.path);
  if (!isWithin(realWorkspaceRoot, realWorkingDirectory)) {
    return workingDirectoryOutsideWorkspace();
  }

  const realHomeResult = await request.source.realPath(
    { path: path.resolve(request.megumiHomePath) },
    options,
  );
  if (realHomeResult.status === 'cancelled') return { status: 'cancelled' };
  if (realHomeResult.status === 'failed') {
    return scopeUnavailable(path.resolve(request.megumiHomePath));
  }

  const scopes: InstructionScope[] = [];
  if (realHomeResult.status === 'resolved') {
    scopes.push({
      directoryPath: path.resolve(request.megumiHomePath),
      allowedRootPath: path.resolve(realHomeResult.path),
      missingIsAllowed: true,
    });
  }
  scopes.push(...directoryChain(workspaceRoot, workingDirectory).map((directoryPath) => ({
    directoryPath,
    allowedRootPath: realWorkspaceRoot,
    missingIsAllowed: false,
  })));

  const sources: AgentInstructionSource[] = [];
  const seenRealSourcePaths = new Set<string>();
  for (const scope of scopes) {
    if (options?.signal?.aborted) return { status: 'cancelled' };

    const directoryResult = await request.source.readDirectory(
      { directoryPath: scope.directoryPath },
      options,
    );
    if (directoryResult.status === 'cancelled') return { status: 'cancelled' };
    if (directoryResult.status === 'missing' && scope.missingIsAllowed) continue;
    if (directoryResult.status === 'missing' || directoryResult.status === 'failed') {
      return directoryReadFailed(scope.directoryPath);
    }
    if (!directoryResult.entries.includes(INSTRUCTION_FILE_NAME)) continue;

    const sourcePath = path.join(scope.directoryPath, INSTRUCTION_FILE_NAME);
    const realSourceResult = await request.source.realPath({ path: sourcePath }, options);
    if (realSourceResult.status === 'cancelled') return { status: 'cancelled' };
    if (realSourceResult.status === 'missing') continue;
    if (realSourceResult.status === 'failed') return sourceReadFailed(sourcePath);

    const realSourcePath = path.resolve(realSourceResult.path);
    if (!isWithin(scope.allowedRootPath, realSourcePath)) {
      return sourceOutsideScope(sourcePath);
    }

    const sourceKey = comparablePath(realSourcePath);
    if (seenRealSourcePaths.has(sourceKey)) continue;

    const fileResult = await request.source.readFile({ filePath: sourcePath }, options);
    if (fileResult.status === 'cancelled') return { status: 'cancelled' };
    if (fileResult.status === 'missing') continue;
    if (fileResult.status === 'failed') return sourceReadFailed(sourcePath);

    seenRealSourcePaths.add(sourceKey);
    sources.push({
      sourceId: `agents:${sourcePath}`,
      sourcePath,
      content: fileResult.content,
    });
  }

  return { status: 'ok', sources };
}

class NodeInstructionSource implements InstructionSource {
  async realPath(
    request: ResolveInstructionPathRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ResolveInstructionPathResult> {
    if (options?.signal?.aborted) return { status: 'cancelled' };
    try {
      const resolvedPath = await realpath(request.path);
      return options?.signal?.aborted
        ? { status: 'cancelled' }
        : { status: 'resolved', path: resolvedPath };
    } catch (error) {
      return mapFileSystemError(error, options);
    }
  }

  async readDirectory(
    request: ReadInstructionDirectoryRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ReadInstructionDirectoryResult> {
    if (options?.signal?.aborted) return { status: 'cancelled' };
    try {
      const entries = await readdir(request.directoryPath);
      return options?.signal?.aborted
        ? { status: 'cancelled' }
        : { status: 'read', entries };
    } catch (error) {
      return mapFileSystemError(error, options);
    }
  }

  async readFile(
    request: ReadInstructionFileRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ReadInstructionFileResult> {
    if (options?.signal?.aborted) return { status: 'cancelled' };
    try {
      const content = await readFile(request.filePath, {
        encoding: 'utf8',
        signal: options?.signal,
      });
      return { status: 'read', content };
    } catch (error) {
      return mapFileSystemError(error, options);
    }
  }
}

function directoryChain(workspaceRoot: string, workingDirectory: string): string[] {
  const relativePath = path.relative(workspaceRoot, workingDirectory);
  const chain = [workspaceRoot];
  if (!relativePath) return chain;

  let currentPath = workspaceRoot;
  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    chain.push(currentPath);
  }
  return chain;
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === ''
    || (!path.isAbsolute(relativePath)
      && relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`));
}

function comparablePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function mapFileSystemError(
  error: unknown,
  options?: InstructionSourceOperationOptions,
): { readonly status: 'missing' | 'failed' | 'cancelled' } {
  if (options?.signal?.aborted || errorCode(error) === 'ABORT_ERR') {
    return { status: 'cancelled' };
  }
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR'
    ? { status: 'missing' }
    : { status: 'failed' };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function workingDirectoryOutsideWorkspace(): LoadInstructionFilesResult {
  return {
    status: 'failed',
    failure: {
      code: 'working_directory_outside_workspace',
      message: 'The working directory must be within the Workspace.',
    },
  };
}

function scopeUnavailable(sourcePath: string): LoadInstructionFilesResult {
  return {
    status: 'failed',
    failure: {
      code: 'instruction_scope_unavailable',
      message: 'An Instructions scope could not be resolved.',
      sourcePath,
    },
  };
}

function directoryReadFailed(sourcePath: string): LoadInstructionFilesResult {
  return {
    status: 'failed',
    failure: {
      code: 'instruction_directory_read_failed',
      message: 'An Instructions directory could not be read.',
      sourcePath,
    },
  };
}

function sourceReadFailed(sourcePath: string): LoadInstructionFilesResult {
  return {
    status: 'failed',
    failure: {
      code: 'instruction_source_read_failed',
      message: 'An Instructions source could not be read.',
      sourcePath,
    },
  };
}

function sourceOutsideScope(sourcePath: string): LoadInstructionFilesResult {
  return {
    status: 'failed',
    failure: {
      code: 'instruction_source_outside_scope',
      message: 'An Instructions source resolves outside its allowed scope.',
      sourcePath,
    },
  };
}
