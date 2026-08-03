/* Executes an already-authorized ToolInvocation inside its Sandbox and Workspace Changes boundary. */

import { executeSandboxScope, type Sandbox } from '@megumi/sandbox';
import type { ToolExecutionAccess, ToolExecutionOptions, ToolExecutionResult } from './tool';
import type { ToolInvocation } from './tool-handler';
import type { WebFetch } from './built-ins/web-fetch';
import type { WebSearch } from './built-ins/web-search';
import type { BuiltInToolContext } from './built-ins/workspace-file-access';
import { createFailedToolResult } from './tool-result';

export interface ToolExecutionPolicy {
  readonly maxExecutionTimeMs: number;
  readonly maxOutputBytes: number;
  readonly maxProcessCount: number;
}

export interface ToolWorkspaceChanges {
  trackToolExecution(request: {
    readonly scope?: {
      readonly workspace_id: string;
      readonly session_id: string;
      readonly run_id: string;
      readonly step_id?: string;
      readonly tool_call_id?: string;
      readonly tool_execution_id?: string;
    };
    readonly execute: () => Promise<ToolExecutionResult>;
  }): Promise<ToolExecutionResult>;
}

export async function executeSandboxToolInvocation(request: {
  readonly sandbox: Sandbox;
  readonly executionPolicy: ToolExecutionPolicy;
  readonly workspaceChanges: ToolWorkspaceChanges;
  readonly workspaceRoot: string;
  readonly invocation: ToolInvocation;
  readonly webSearch?: WebSearch;
  readonly webFetch: WebFetch;
  readonly stepId?: string;
  readonly toolExecutionId?: string;
  readonly options: ToolExecutionOptions & { readonly executionAccess: ToolExecutionAccess };
  readonly execute: (context: BuiltInToolContext) => Promise<ToolExecutionResult>;
}): Promise<ToolExecutionResult> {
  const execution = await executeSandboxScope({
    sandbox: request.sandbox,
    open: {
      policy: {
        workspaceRoot: request.workspaceRoot,
        ...request.executionPolicy,
        executionAccess: request.options.executionAccess,
      },
      ...(request.options.signal ? { signal: request.options.signal } : {}),
    },
    async execute(scope) {
      const context: BuiltInToolContext = {
        workspaceFileAccess: scope.files,
        process: scope.process,
        ...(request.webSearch ? { webSearch: request.webSearch } : {}),
        webFetch: request.webFetch,
      };
      return request.workspaceChanges.trackToolExecution({
        scope: {
          workspace_id: request.invocation.workspaceId,
          session_id: request.invocation.sessionId,
          run_id: request.invocation.runId,
          ...(request.stepId ? { step_id: request.stepId } : {}),
          tool_call_id: request.invocation.toolCallId,
          ...(request.toolExecutionId ? { tool_execution_id: request.toolExecutionId } : {}),
        },
        execute: () => request.execute(context),
      });
    },
  });
  if (execution.status === 'unavailable') {
    return createFailedToolResult({
      toolName: request.invocation.toolName,
      code: 'sandbox_unavailable',
      message: execution.reason,
    });
  }
  if (execution.status === 'termination_unconfirmed') {
    return createFailedToolResult({
      toolName: request.invocation.toolName,
      code: 'termination_unconfirmed',
      message: 'Sandbox scope could not confirm process termination.',
      ...(execution.value.effectReport ? { effectReport: execution.value.effectReport } : {}),
    });
  }
  return execution.value;
}
