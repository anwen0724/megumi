// Defines tool-owned contracts for registry, calls, execution, results, executors, host ports, and audit.
import type { PermissionOperation, PolicyDecision } from '../permission';
import type { JsonObject, JsonValue, MegumiError } from '../shared';
import type { WorkspaceManager } from '../workspace';

export type ToolSideEffect = 'read' | 'write' | 'exec' | 'network';
export type ToolExecutionMode = 'serial' | 'parallel';
export type ToolMutationKind = 'read_only' | 'mutation' | 'process' | 'network' | 'external_state';

export interface ToolExecutionConstraint {
  executionMode: ToolExecutionMode;
  mutation: ToolMutationKind;
  requiresPermission: boolean;
  supportsCancellation: boolean;
}

export interface ToolSource {
  kind: 'builtin' | 'project' | 'plugin' | 'skill';
  id: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
  source: ToolSource;
  sideEffect: ToolSideEffect;
  execution: ToolExecutionConstraint;
  permission: {
    operation: PermissionOperation;
  };
}

export interface ModelVisibleTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface ToolSetProjection {
  tools: ModelVisibleTool[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: JsonObject;
}

export type ToolExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'rejected' | 'awaiting_approval';

export interface ToolExecution {
  id: string;
  toolCallId: string;
  toolName: string;
  status: ToolExecutionStatus;
  runId?: string;
  sessionId?: string;
  workspaceId?: string;
  turnIndex?: number;
  startedAt?: string;
  endedAt?: string;
  workspaceChangeSetId?: string;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: JsonObject;
}

export type ToolResult =
  | {
      status: 'success';
      toolCallId: string;
      toolName: string;
      text: string;
      data?: JsonValue;
    }
  | {
      status: 'error';
      toolCallId: string;
      toolName: string;
      error: ToolError;
    }
  | {
      status: 'rejected';
      toolCallId: string;
      toolName: string;
      decision: PolicyDecision;
      text: string;
    }
  | {
      status: 'awaiting_approval';
      toolCallId: string;
      toolName: string;
      decision: PolicyDecision;
      approvalRequestId?: string;
      text: string;
    };

export interface ToolAuditRecord {
  id: string;
  toolCallId: string;
  toolName: string;
  status: ToolResult['status'];
  runId?: string;
  sessionId?: string;
  workspaceId?: string;
  decision?: PolicyDecision;
  createdAt: string;
  error?: ToolError;
}

export interface ToolProcessHost {
  runCommand(input: { command: string; cwd?: string; timeoutMs?: number; envPolicy?: 'default' | 'minimal' | 'none' }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface ToolExecutionContext {
  workspace: WorkspaceManager;
  processHost?: ToolProcessHost;
}

export interface ToolExecutor {
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

export function toolErrorFromUnknown(error: unknown): ToolError {
  const known = error as Partial<MegumiError>;
  return {
    code: typeof known.code === 'string' ? known.code : 'TOOL_EXECUTION_FAILED',
    message: error instanceof Error ? error.message : 'Tool execution failed.',
    retryable: false,
  };
}
