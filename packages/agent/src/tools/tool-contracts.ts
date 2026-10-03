/*
 * Keeps a tool's model declaration, permission facts and executable implementation together.
 */
import type { JsonObject, Tool } from '@megumi/ai';

export interface ToolDefinition extends Tool {
  readonly executionMode?: 'parallel' | 'serial';
  readonly promptSnippet?: string;
  readonly label?: string;
  readonly promptGuidelines?: readonly string[];
}

export interface PermissionOperation {
  readonly action: 'workspace.read' | 'workspace.write' | 'process.execute'
    | 'network.search' | 'network.fetch' | 'agent.context.activate' | 'external.invoke';
  readonly resource?: {
    readonly type: 'workspace.path' | 'process.command' | 'network.public_web' | 'network.url' | 'tool.identity';
    readonly id?: string;
    readonly attributes?: JsonObject;
  };
}

export type PermissionMode = 'ask' | 'auto' | 'full_access';

export interface RawToolResult {
  readonly outputKind: 'text' | 'json' | 'command' | 'file' | 'diff' | 'error';
  readonly content: unknown;
  readonly isError?: boolean;
  readonly error?: { readonly code: string; readonly message: string; readonly details?: JsonObject };
  readonly metadata?: JsonObject;
}

export interface ToolExecutionContext {
  readonly runId: string;
  readonly toolCallId: string;
  readonly signal: AbortSignal;
  readonly onOutput: (output: { readonly stream: 'stdout' | 'stderr'; readonly chunk: string; readonly truncated: boolean }) => void;
}

export interface AgentTool<Input = unknown> extends ToolDefinition {
  /** Describes the validated operation without performing it. */
  operations(input: Input): readonly PermissionOperation[];
  /** Resolves only after the actual operation and its cleanup have stopped. */
  execute(input: Input, execution: ToolExecutionContext): Promise<RawToolResult>;
}

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly operations: readonly PermissionOperation[];
  readonly signal: AbortSignal;
}

export type ApprovalDecision =
  | { readonly status: 'allowed' }
  | { readonly status: 'denied' }
  | { readonly status: 'cancelled' };
