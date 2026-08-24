/* Provides the small shared builder used by co-located built-in Tool handlers. */

import type { PermissionActionId, PermissionResourceType } from '@megumi/permissions';
import type { ToolHandler, ToolInvocation } from '../tool-handler';
import type { RawToolResult, ToolExecutionOptions } from '../tool';
import type { BuiltInToolContext } from './workspace-file-access';

export function createBuiltInToolHandler(request: {
  readonly toolName: string;
  readonly operations: (invocation: ToolInvocation) => ReturnType<ToolHandler['operations']>;
  readonly execute: (
    context: BuiltInToolContext,
    input: unknown,
    options: ToolExecutionOptions,
  ) => Promise<RawToolResult>;
}): ToolHandler<BuiltInToolContext> {
  return {
    toolName: request.toolName,
    operations: request.operations,
    execute: (context, invocation, options = {}) => request.execute(context, invocation.input, options),
  };
}

export function operation(
  invocation: ToolInvocation,
  action: PermissionActionId,
  resource?: {
    readonly type: PermissionResourceType;
    readonly id?: string;
    readonly attributes?: Record<string, string | number | boolean | null>;
  },
) {
  if (!invocation.workspaceId || !invocation.sessionId) {
    throw new Error(`Built-in Tool requires a Session-backed execution: ${invocation.toolName}`);
  }
  return {
    action,
    ...(resource ? { resource } : {}),
    context: {
      workspaceId: invocation.workspaceId,
      sessionId: invocation.sessionId,
      executionId: invocation.executionId,
      toolIdentity: invocation.toolIdentity,
    },
  } as const;
}

export function inputString(invocation: ToolInvocation, key: string, fallback?: string): string {
  const value = invocation.input && typeof invocation.input === 'object' && !Array.isArray(invocation.input)
    ? invocation.input[key]
    : undefined;
  return typeof value === 'string' && value.length > 0 ? value : fallback ?? '';
}
