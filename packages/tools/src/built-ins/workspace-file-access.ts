/* Defines the minimal Workspace, Skills, process, and Web interfaces used by built-in Tools. */

import path from 'node:path';
import type { UseSkillRequest, UseSkillResponse } from '@megumi/skills';
import { ToolExecutionFailure } from '../tool-result';
import type { ToolProcessAdapter } from './run-command';
import type { WebFetch } from './web-fetch';
import type { WebSearch } from './web-search';

export interface WorkspaceFileAccess {
  readBinaryFile?(request: {
    readonly path: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly path: string;
    readonly bytes: Uint8Array;
    readonly sizeBytes: number;
  }>;
  readFile(request: {
    readonly path: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly path: string;
    readonly content: string;
    readonly sizeBytes: number;
  }>;
  listDirectory(request: {
    readonly path: string;
    readonly maxDepth: number;
    readonly includeHidden: boolean;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly path: string;
    readonly entries: readonly {
      readonly name: string;
      readonly kind: 'file' | 'directory';
      readonly path: string;
    }[];
  }>;
  walkFiles(request: {
    readonly path: string;
    readonly includeHidden?: boolean;
    readonly signal?: AbortSignal;
  }): Promise<readonly string[]>;
  replaceText(request: {
    readonly path: string;
    readonly oldText: string;
    readonly newText: string;
    readonly replaceAll: boolean;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly path: string;
    readonly replacements: number;
    readonly changed: boolean;
  }>;
  writeFile(request: {
    readonly path: string;
    readonly content: string;
    readonly overwrite: boolean;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly path: string;
    readonly bytesWritten: number;
    readonly created: boolean;
    readonly overwritten: boolean;
  }>;
  resolveCommandCwd(request: {
    readonly path: string;
    readonly signal?: AbortSignal;
  }): Promise<string>;
}

export interface SkillUse {
  useSkill(request: UseSkillRequest): Promise<UseSkillResponse>;
}

export interface BuiltInToolContext {
  readonly workspaceFileAccess: WorkspaceFileAccess;
  readonly process?: ToolProcessAdapter;
  readonly skills?: SkillUse;
  readonly webSearch?: WebSearch;
  readonly webFetch?: WebFetch;
}

export async function withFileFailure<T>(
  operation: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const reason = fileFailureReason(error);
    if (!reason) throw error;
    throw new ToolExecutionFailure(fileFailureMessage(reason), 'tool_execution_failed', {
      reason,
      operation,
    });
  }
}

export function assertTextMutationTarget(targetPath: string): void {
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === '.docx' || extension === '.pdf') {
    throw new ToolExecutionFailure(
      `${extension.slice(1).toUpperCase()} structured editing is not supported by text file tools.`,
      'tool_execution_failed',
      { reason: 'unsupported_structured_document', extension },
    );
  }
}

function fileFailureReason(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
  if (code === 'ENOENT') return 'not_found';
  if (code === 'EACCES' || code === 'EPERM') return 'access_denied';
  if (code === 'EISDIR') return 'expected_file';
  if (code === 'ENOTDIR') return 'expected_directory';
  return undefined;
}

function fileFailureMessage(reason: string): string {
  if (reason === 'not_found') return 'The requested file or directory was not found.';
  if (reason === 'access_denied') return 'Access to the requested file or directory was denied.';
  if (reason === 'expected_file') return 'The requested path is not a readable file.';
  return 'The requested path is not a readable directory.';
}
