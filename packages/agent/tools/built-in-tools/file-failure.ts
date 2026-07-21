/* Converts reliable filesystem error codes into safe Tool Result details. */
import { ToolExecutionFailure } from '../core/tool-execution-failure';

export async function withFileFailure<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const reason = fileFailureReason(error);
    if (!reason) throw error;
    throw new ToolExecutionFailure(fileFailureMessage(reason), 'tool_execution_failed', { reason, operation });
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
