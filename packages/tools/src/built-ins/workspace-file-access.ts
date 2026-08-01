/* Defines the Sandbox-backed Workspace, Skills, process, and Web interfaces used by built-in Tools. */

import path from 'node:path';
import type { SandboxFileAccess } from '@megumi/sandbox';
import type { UseSkillRequest, UseSkillResponse } from '@megumi/skills';
import type { ToolEffectPath, ToolExecutionErrorCode } from '../tool';
import { ToolExecutionFailure } from '../tool-result';
import type { ToolProcessAdapter } from './run-command';
import type { WebFetch } from './web-fetch';
import type { WebSearch } from './web-search';

export type WorkspaceFileAccess = SandboxFileAccess;

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